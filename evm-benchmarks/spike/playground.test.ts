// Playground spike (t-19): webevm persistence restores blocks/receipts; revm via the engine option.
import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {createNode, type PersistenceAdapter} from 'webevm';
import {createRevmEngine} from 'webevm/revm';
import {privateKeyToAccount} from 'viem/accounts';

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const to = '0x000000000000000000000000000000000000dEaD';
const opts = {chainId: 31337, senderMode: 'trusted', miningConfig: {type: 'auto'}} as const;

const memoryPersistence = () => {
  let saved: Awaited<ReturnType<PersistenceAdapter['load']>> = null;
  const saves: number[] = [];
  const adapter: PersistenceAdapter = {
    load: async () => saved,
    save: async (s) => {
      saved = structuredClone(s);
      saves.push(1);
    },
  };
  return {adapter, saves};
};

type Node = Awaited<ReturnType<typeof createNode>>;
const rpc = (n: Node, method: string, params: unknown[] = []) => n.request({method, params}) as Promise<any>;
const transfer = async (n: Node, nonce: number) => {
  const raw = await account.signTransaction({
    type: 'eip1559', chainId: 31337, nonce, to, value: 1n, gas: 21_000n,
    maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
  });
  return (await rpc(n, 'evm_sendRawTransactionSyncAs', [raw, account.address])).transactionHash as string;
};

test('persistence restores blocks and receipts', async () => {
  const {adapter} = memoryPersistence();
  const a = await createNode({...opts, persistence: adapter, initialBalances: {[account.address]: 10n ** 21n}});
  const hashes: string[] = [];
  for (let i = 0; i < 3; i++) hashes.push(await transfer(a, i));
  const balances = await Promise.all([account.address, to].map((x) => rpc(a, 'eth_getBalance', [x, 'latest'])));
  await a.dispose();

  const b = await createNode({...opts, persistence: adapter});
  expect(await rpc(b, 'eth_blockNumber')).toBe('0x3');
  const block = await rpc(b, 'eth_getBlockByNumber', ['0x2', true]);
  expect(block.transactions.map((t: any) => t.hash)).toEqual([hashes[1]]);
  expect((await rpc(b, 'eth_getTransactionReceipt', [hashes[0]])).status).toBe('0x1');
  expect(await Promise.all([account.address, to].map((x) => rpc(b, 'eth_getBalance', [x, 'latest'])))).toEqual(balances);
  await b.dispose();
});

test('initialBalances do not override restored state', async () => {
  const {adapter} = memoryPersistence();
  const a = await createNode({...opts, persistence: adapter, initialBalances: {[account.address]: 10n ** 21n}});
  await transfer(a, 0);
  const spent = await rpc(a, 'eth_getBalance', [account.address, 'latest']);
  await a.dispose();
  const b = await createNode({...opts, persistence: adapter, initialBalances: {[account.address]: 5n}});
  expect(await rpc(b, 'eth_getBalance', [account.address, 'latest'])).toBe(spent);
  await b.dispose();
});

test('revm engine via engine option', async () => {
  const wasm = readFileSync(require.resolve('revm-wasm/revm.wasm'));
  const n = await createNode({...opts, engine: await createRevmEngine({wasm}), initialBalances: {[account.address]: 10n ** 21n}});
  expect((await rpc(n, 'eth_getTransactionReceipt', [await transfer(n, 0)])).status).toBe('0x1');
  expect(n.engine.id).toBe('revm-wasm');
  await n.dispose();
});
