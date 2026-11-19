// webevm spike (t-01): confirms trusted sender, manual mining, big blocks, revm in Bun.
// Throughput numbers are logged by the `throughput probe` test; see the ADR notes.
// Measured (Bun 1.3.13, macOS, default engine, 2000 single-sender transfers incl. node.request overhead):
//   recover + auto mining:        ~1700 tx/s
//   trusted + manual (block 500): ~16900 tx/s
import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {createNode} from 'webevm';
import {createRevmEngine} from 'webevm/revm';
import {privateKeyToAccount} from 'viem/accounts';

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const to = '0x000000000000000000000000000000000000dEaD';
const funds = {[account.address]: 10n ** 24n};

const signMany = (count: number, start = 0) =>
  Promise.all(
    Array.from({length: count}, (_, i) =>
      account.signTransaction({
        type: 'eip1559',
        chainId: 31337,
        nonce: start + i,
        to,
        value: 1n,
        gas: 21_000n,
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
      }),
    ),
  );

const trusted = (extra = {}) =>
  createNode({chainId: 31337, senderMode: 'trusted', initialBalances: funds, ...extra});
const receipt = (node: Awaited<ReturnType<typeof createNode>>, hash: unknown) =>
  node.request({method: 'eth_getTransactionReceipt', params: [hash]}) as Promise<any>;

test('trusted sender executes via evm_sendRawTransactionSyncAs', async () => {
  const node = await trusted();
  const [raw] = await signMany(1);
  const r: any = await node.request({method: 'evm_sendRawTransactionSyncAs', params: [raw, account.address]});
  expect(r.status).toBe('0x1');
  await node.dispose();
});

test('manual mining queues until mine()', async () => {
  const node = await trusted({miningConfig: {type: 'manual'}});
  const hashes: unknown[] = [];
  for (const raw of await signMany(3))
    hashes.push(await node.request({method: 'evm_sendRawTransactionAs', params: [raw, account.address]}));
  for (const h of hashes) expect(await receipt(node, h)).toBeNull();
  await node.mine();
  const rs = await Promise.all(hashes.map((h) => receipt(node, h)));
  expect(rs.map((r) => r.status)).toEqual(['0x1', '0x1', '0x1']);
  console.log('manual mining: 3 txs in blocks', rs.map((r) => r.blockNumber));
  await node.dispose();
});

test('blockGasLimit allows 1000 transfers per block', async () => {
  const node = await trusted({miningConfig: {type: 'manual'}, blockGasLimit: 30_000_000n * 10n});
  const hashes: unknown[] = [];
  for (const raw of await signMany(1000))
    hashes.push(await node.request({method: 'evm_sendRawTransactionAs', params: [raw, account.address]}));
  const mined = await node.mine();
  expect(mined.txHashes.length).toBe(1000);
  const rs = await Promise.all(hashes.map((h) => receipt(node, h)));
  expect(rs.every((r) => r.status === '0x1')).toBe(true);
  await node.dispose();
});

test('revm engine loads in Bun', async () => {
  const wasm = readFileSync(require.resolve('revm-wasm/revm.wasm'));
  const engine = await createRevmEngine({wasm});
  const node = await trusted({engine});
  const [raw] = await signMany(1);
  const r: any = await node.request({method: 'evm_sendRawTransactionSyncAs', params: [raw, account.address]});
  expect(r.status).toBe('0x1');
  console.log('engine id:', node.engine.id);
  await node.dispose();
});

test('throughput probe', async () => {
  const raws = await signMany(2000);
  const rate = async (label: string, node: Awaited<ReturnType<typeof createNode>>, method: string, block?: number) => {
    const t0 = performance.now();
    let n = 0;
    for (const raw of raws) {
      await node.request({method, params: method.endsWith('As') ? [raw, account.address] : [raw]});
      if (block && ++n % block === 0) await node.mine();
    }
    if (block) await node.mine();
    const tps = Math.round(raws.length / ((performance.now() - t0) / 1000));
    console.log(`throughput ${label}: ${tps} tx/s`);
    await node.dispose();
    return tps;
  };
  const a = await rate('recover+auto', await createNode({chainId: 31337, initialBalances: funds}), 'eth_sendRawTransaction');
  const b = await rate(
    'trusted+manual(500)',
    await trusted({miningConfig: {type: 'manual'}, blockGasLimit: 30_000_000n * 10n}),
    'evm_sendRawTransactionAs',
    500,
  );
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(0);
}, 120_000);
