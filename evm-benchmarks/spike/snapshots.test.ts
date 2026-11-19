// Snapshots spike (plan 6, t-48): is webevm dumpState/loadState faithful enough to build snapshots on?
import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {createNode} from 'webevm';
import {createRevmEngine} from 'webevm/revm';
import {privateKeyToAccount} from 'viem/accounts';

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const to = '0x000000000000000000000000000000000000dEaD';
const wasm = readFileSync(require.resolve('revm-wasm/revm.wasm'));

type Node = Awaited<ReturnType<typeof createNode>>;
type Engine = 'default' | 'revm';
type Mining = 'auto' | 'manual';
const rpc = (n: Node, method: string, params: unknown[] = []) => n.request({method, params}) as Promise<any>;

const make = async (engine: Engine, mining: Mining): Promise<Node> =>
  createNode({
    chainId: 31337,
    senderMode: 'trusted',
    miningConfig: {type: mining},
    ...(engine === 'revm' ? {engine: await createRevmEngine({wasm})} : {}),
    initialBalances: {[account.address]: 10n ** 21n},
  });

const signed = (nonce: number) =>
  account.signTransaction({
    type: 'eip1559', chainId: 31337, nonce, to, value: 1n, gas: 21_000n,
    maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
  });

// auto: one block per tx. manual: queue, then mine (blocks of up to 3 txs).
const sendTxs = async (n: Node, mining: Mining, from: number, count: number) => {
  for (let i = from; i < from + count; i++) {
    const raw = await signed(i);
    if (mining === 'auto') await rpc(n, 'evm_sendRawTransactionSyncAs', [raw, account.address]);
    else {
      await rpc(n, 'evm_sendRawTransactionAs', [raw, account.address]);
      if ((i - from) % 3 === 2 || i === from + count - 1) await n.mine();
    }
  }
};

// The encoding Task 3 will ship: BigInt <-> {"$bigint":"<decimal>"}.
const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? {$bigint: v.toString()} : v);
const reviver = (_k: string, v: any) =>
  v && typeof v === 'object' && typeof v.$bigint === 'string' && Object.keys(v).length === 1 ? BigInt(v.$bigint) : v;
const encode = (d: unknown) => JSON.stringify(d, replacer);
const decode = (s: string) => JSON.parse(s, reviver);

// Everything observable through RPC that a snapshot must preserve.
const observe = async (n: Node) => {
  const height = parseInt(await rpc(n, 'eth_blockNumber'), 16);
  const blocks: any[] = [];
  const receipts: any[] = [];
  for (let i = 0; i <= height; i++) {
    const b = await rpc(n, 'eth_getBlockByNumber', ['0x' + i.toString(16), true]);
    blocks.push({hash: b.hash, parentHash: b.parentHash, timestamp: b.timestamp, txs: b.transactions.map((t: any) => t.hash)});
    for (const t of b.transactions) receipts.push(await rpc(n, 'eth_getTransactionReceipt', [t.hash]));
  }
  const balances = await Promise.all([account.address, to].map((a) => rpc(n, 'eth_getBalance', [a, 'latest'])));
  const nonce = await rpc(n, 'eth_getTransactionCount', [account.address, 'latest']);
  return {height, blocks, receipts, balances, nonce};
};

const combos: [Mining, Engine][] = [];
for (const m of ['auto', 'manual'] as const) for (const e of ['default', 'revm'] as const) combos.push([m, e]);

for (const [mining, engine] of combos) {
  const label = `${mining} mining, ${engine} engine`;

  test(`dump -> load into a fresh node is identical (${label})`, async () => {
    const a = await make(engine, mining);
    await sendTxs(a, mining, 0, 5);
    const before = await observe(a);
    expect(before.height).toBeGreaterThanOrEqual(2);
    expect(before.receipts.length).toBe(5);
    const dump = await a.dumpState();
    await a.dispose();

    // A later wall-clock second would change a fresh genesis; the dump's own block 0 must win.
    await new Promise((r) => setTimeout(r, 1100));
    const b = await make(engine, mining);
    await b.loadState(dump);
    expect(await observe(b)).toEqual(before);
    await b.dispose();
  });

  test(`dump survives the $bigint JSON round trip (${label})`, async () => {
    const a = await make(engine, mining);
    await sendTxs(a, mining, 0, 5);
    const dump = await a.dumpState();
    await a.dispose();
    const roundTripped = decode(encode(dump));
    expect(roundTripped).toEqual(dump);
    // and it still loads and matches
    const b = await make(engine, mining);
    await b.loadState(roundTripped);
    expect(parseInt(await rpc(b, 'eth_blockNumber'), 16)).toBeGreaterThanOrEqual(2);
    await b.dispose();
  });

  test(`restore into a running node discards later blocks (${label})`, async () => {
    const n = await make(engine, mining);
    await sendTxs(n, mining, 0, 3);
    const h3 = await rpc(n, 'eth_blockNumber');
    const at3 = await observe(n);
    const dump3 = await n.dumpState();
    await sendTxs(n, mining, 3, 2);
    expect(parseInt(await rpc(n, 'eth_blockNumber'), 16)).toBeGreaterThan(parseInt(h3, 16));
    const gone = await rpc(n, 'eth_getBlockByNumber', [await rpc(n, 'eth_blockNumber'), false]);
    await n.loadState(dump3);
    expect(await rpc(n, 'eth_blockNumber')).toBe(h3);
    expect(await rpc(n, 'eth_getBlockByNumber', [gone.number, false])).toBeNull();
    expect(await rpc(n, 'eth_getTransactionReceipt', [gone.transactions[0]])).toBeNull();
    expect(await observe(n)).toEqual(at3);
    // the node still works after a restore
    await sendTxs(n, mining, 3, 1);
    expect(parseInt(await rpc(n, 'eth_blockNumber'), 16)).toBeGreaterThan(parseInt(h3, 16));
    await n.dispose();
  });
}

const cross = async (from: Engine, into: Engine) => {
  const a = await make(from, 'auto');
  await sendTxs(a, 'auto', 0, 5);
  const before = await observe(a);
  const dump = await a.dumpState();
  await a.dispose();
  const b = await make(into, 'auto');
  await b.loadState(dump);
  expect(await observe(b)).toEqual(before);
  await sendTxs(b, 'auto', 5, 1); // keeps executing on the new engine
  await b.dispose();
};
test('cross-engine: default dump loads into revm', () => cross('default', 'revm'));
test('cross-engine: revm dump loads into default', () => cross('revm', 'default'));

for (const engine of ['default', 'revm'] as const) {
  test(`2,000-block chain: dump, encode, decode (${engine})`, async () => {
    const n = await make(engine, 'auto');
    const tBuild = performance.now();
    await sendTxs(n, 'auto', 0, 2000);
    const build = performance.now() - tBuild;
    expect(parseInt(await rpc(n, 'eth_blockNumber'), 16)).toBe(2000);
    const t0 = performance.now();
    const dump = await n.dumpState();
    const t1 = performance.now();
    const text = encode(dump);
    const t2 = performance.now();
    const back = decode(text);
    const t3 = performance.now();
    expect(back).toEqual(dump);
    const t4 = performance.now();
    const m = await make(engine, 'auto');
    await m.loadState(back);
    const t5 = performance.now();
    expect(parseInt(await rpc(m, 'eth_blockNumber'), 16)).toBe(2000);
    console.log(
      `2000 blocks (${engine}): build ${build.toFixed(0)}ms, dump ${(t1 - t0).toFixed(0)}ms, encode ${(t2 - t1).toFixed(0)}ms, ` +
        `decode ${(t3 - t2).toFixed(0)}ms, load ${(t5 - t4).toFixed(0)}ms, size ${(text.length / 1024).toFixed(0)} KB`,
    );
    await n.dispose();
    await m.dispose();
  }, 120_000);
}

// C1 regression: loadState into a RUNNING node only puts the dump's accounts/code/storage and never
// clears what was created after the snapshot, so restore must load into a fresh node instead.
for (const engine of ['default', 'revm'] as const) {
  test(`loadState merges into a running node; a fresh node is clean (${engine})`, async () => {
    const C = '0x00000000000000000000000000000000000c0ffe';
    const n = await make(engine, 'auto');
    await sendTxs(n, 'auto', 0, 1);
    const dump = await n.dumpState();
    const tx = (nonce: number, extra: object) =>
      account.signTransaction({
        type: 'eip1559', chainId: 31337, nonce, gas: 100_000n,
        maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, ...extra,
      });
    await rpc(n, 'evm_sendRawTransactionSyncAs', [await tx(1, {to: C, value: 5n}), account.address]);
    const rc = await rpc(n, 'evm_sendRawTransactionSyncAs', [await tx(2, {data: '0x602a60005560ff60005360016000f3'}), account.address]);
    const K = rc.contractAddress;
    expect(await rpc(n, 'eth_getCode', [K, 'latest'])).toBe('0xff');

    await n.loadState(dump); // the webevm 0.9.1 behaviour restore must avoid
    expect(BigInt(await rpc(n, 'eth_getBalance', [C, 'latest']))).toBe(5n);
    expect(await rpc(n, 'eth_getCode', [K, 'latest'])).toBe('0xff');

    const f = await make(engine, 'auto');
    await f.loadState(dump);
    expect(BigInt(await rpc(f, 'eth_getBalance', [C, 'latest']))).toBe(0n);
    expect(await rpc(f, 'eth_getCode', [K, 'latest'])).toBe('0x');
    expect(BigInt(await rpc(f, 'eth_getStorageAt', [K, '0x0', 'latest']))).toBe(0n);
    await n.dispose();
    await f.dispose();
  });
}
