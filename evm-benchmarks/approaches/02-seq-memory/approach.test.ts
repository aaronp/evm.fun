import {afterEach, beforeEach, expect, test} from 'bun:test';
import {keccak256} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {runBenchmark, scenarios, type Hex, type Scenario} from '@evmb/core';
import {readFileSync} from 'node:fs';
import {createRevmEngine} from 'webevm/revm';
import create from './index.ts';

const opts = {workers: '2', block: '10', chunk: '4'};
const a = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const B = '0x000000000000000000000000000000000000dEaD' as const;
const sign = (nonce: number) =>
  a.signTransaction({
    type: 'eip1559',
    chainId: 31337,
    nonce,
    to: B,
    value: 1n,
    gas: 21_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  });

// Track every Worker the approach creates and whether it was terminated.
const RealWorker = globalThis.Worker;
let made: {terminated: boolean}[] = [];
beforeEach(() => {
  made = [];
  globalThis.Worker = class extends RealWorker {
    rec = {terminated: false};
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      made.push(this.rec);
    }
    override terminate() {
      this.rec.terminated = true;
      super.terminate();
    }
  } as typeof Worker;
});
afterEach(() => {
  globalThis.Worker = RealWorker;
});

test('runs all five scenarios verified', async () => {
  for (const id of Object.keys(scenarios) as Scenario['id'][]) {
    const approach = create(opts);
    try {
      const r = await runBenchmark({approach, scenario: scenarios[id](), n: 60, senders: 6, seed: 't7'});
      expect({id, verified: r.verified, detail: r.verifyDetail, success: r.statuses.success}).toEqual({
        id,
        verified: true,
        detail: r.verifyDetail,
        success: 60,
      });
      expect(Object.keys(r.phases!).sort()).toEqual(['executeMs', 'mineMs', 'sequenceMs', 'verifyMs']);
    } finally {
      await approach.dispose();
    }
  }
}, 120_000);

test('preserves submit order across chunks', async () => {
  const ap = create(opts);
  await ap.setup({prefund: {[a.address]: 10n ** 24n}});
  const raws = await Promise.all(Array.from({length: 30}, (_, i) => sign(i)));
  for (let i = 0; i < 30; i += 10) await ap.submit(raws.slice(i, i + 10));
  const rs = await ap.awaitSettled(raws.map((r) => keccak256(r)));
  expect(rs.map((r) => r.status)).toEqual(Array(30).fill('success'));
  expect(await ap.getBalance(B)).toBe(30n);
  await ap.dispose();
}, 60_000);

test('garbage raw tx is rejected', async () => {
  const ap = create(opts);
  await ap.setup({prefund: {[a.address]: 10n ** 24n}});
  const good = await sign(0);
  await ap.submit(['0x1234', good]);
  const [bad, ok] = await ap.awaitSettled([keccak256('0x1234' as Hex), keccak256(good)]);
  expect(bad?.status).toBe('rejected');
  expect(typeof bad?.error).toBe('string');
  expect(ok?.status).toBe('success');
  await ap.dispose();
}, 60_000);

test('dispose then reuse', async () => {
  const ap = create(opts);
  expect(made.length).toBe(0); // factory allocates nothing
  for (let i = 0; i < 2; i++) {
    const r = await runBenchmark({approach: ap, scenario: scenarios['eth-transfer'](), n: 30, senders: 3, seed: `reuse${i}`});
    expect(r.verified).toBe(true);
    await ap.dispose();
  }
  expect(made.length).toBe(4);
  expect(made.every((w) => w.terminated)).toBe(true);
}, 60_000);

test('rejects non-positive or non-integer options', () => {
  for (const [k, v] of [['chunk', '0'], ['block', '-5'], ['workers', '1.5'], ['block', 'abc']])
    expect(() => create({[k!]: v!})).toThrow(`02-seq-memory: ${k} must be a positive integer, got ${v}`);
  expect(() => create({workers: '2', block: '10', chunk: '5'})).not.toThrow();
});

const memoryPersistence = () => {
  let saved: any = null;
  return {load: async () => saved, save: async (s: any) => void (saved = structuredClone(s))};
};
const rpc = (ap: ReturnType<typeof create>, m: string, p: unknown[] = []) => ap.request!(m, p) as Promise<any>;

test('request passes reads through to the node', async () => {
  const ap = create(opts);
  await ap.setup({prefund: {[a.address]: 10n ** 24n}});
  await ap.submit([await sign(0)]);
  await ap.awaitSettled([keccak256(await sign(0))]);
  expect(await rpc(ap, 'eth_blockNumber')).toBe('0x1');
  await ap.dispose();
});

test('revm engine + persistence: open() restores history and balances', async () => {
  const wasm = readFileSync(require.resolve('revm-wasm/revm.wasm'));
  const host = {createEngine: () => createRevmEngine({wasm}), persistence: memoryPersistence()};
  const one = create(opts, host);
  expect(one.meta.engine).toBe('webevm@0.9.1+revm');
  await one.setup({prefund: {[a.address]: 10n ** 21n}});
  const raws = [await sign(0), await sign(1)];
  await one.submit(raws);
  const rs = await one.awaitSettled(raws.map((r) => keccak256(r)));
  expect(rs.map((r) => r.status)).toEqual(['success', 'success']);
  const bal = await Promise.all([a.address, B].map((x) => one.getBalance(x)));
  const receipt = await rpc(one, 'eth_getTransactionReceipt', [keccak256(raws[1]!)]);
  const head = await rpc(one, 'eth_blockNumber');
  await one.dispose();

  const two = create(opts, host);
  await two.open!();
  expect(await Promise.all([a.address, B].map((x) => two.getBalance(x)))).toEqual(bal);
  expect(await rpc(two, 'eth_getTransactionReceipt', [keccak256(raws[1]!)])).toEqual(receipt);
  expect(await rpc(two, 'eth_blockNumber')).toBe(head);
  await two.dispose();
});

test('open() throws when nothing was persisted', async () => {
  const ap = create(opts, {persistence: memoryPersistence()});
  await expect(ap.open!()).rejects.toThrow(/nothing persisted/);
  await ap.dispose();
});

test('setup() makes the reset durable before any tx', async () => {
  const host = {persistence: memoryPersistence()};
  const one = create(opts, host);
  await one.setup({prefund: {[a.address]: 10n ** 21n}});
  await one.submit([await sign(0)]);
  await one.awaitSettled([keccak256(await sign(0))]);
  await one.dispose();
  const two = create(opts, host);
  await two.setup({prefund: {[a.address]: 7n}});
  await two.dispose();
  const three = create(opts, host);
  await three.open!();
  expect(await three.getBalance(a.address)).toBe(7n);
  expect(await rpc(three, 'eth_blockNumber')).toBe('0x0');
  await three.dispose();
});

// --- snapshot / restore / setup({dump}) ---
const snapRaws = async (from: number, n: number) => Promise.all(Array.from({length: n}, (_, i) => sign(from + i)));
const settle = async (ap: ReturnType<typeof create>, raws: Hex[]) => {
  await ap.submit(raws);
  return ap.awaitSettled(raws.map((r) => keccak256(r)));
};
const memPersist = () => {
  let saved: any = null;
  return {load: async () => saved, save: async (s: any) => void (saved = structuredClone(s))};
};

test('snapshot -> more txs -> restore rewinds head, balances and receipts', async () => {
  const ap = create(opts);
  await ap.setup({prefund: {[a.address]: 10n ** 21n}});
  await settle(ap, await snapRaws(0, 3));
  const head = await ap.request!('eth_blockNumber');
  const bal = await ap.getBalance(B);
  const dump = await ap.snapshot!();
  const later = await snapRaws(3, 2);
  await settle(ap, later);
  expect(await ap.getBalance(B)).toBe(bal + 2n);
  await ap.restore!(dump);
  expect(await ap.request!('eth_blockNumber')).toBe(head);
  expect(await ap.getBalance(B)).toBe(bal);
  // own receipts for vanished blocks are gone: the same txs settle afresh and the node still works
  expect(await ap.request!('eth_getTransactionReceipt', [keccak256(later[0]!)])).toBeNull();
  const again = await settle(ap, later);
  expect(again.map((r) => r.status)).toEqual(['success', 'success']);
  expect(await ap.getBalance(B)).toBe(bal + 2n);
  await ap.dispose();
});

test('restore drops the approach receipts for blocks that no longer exist', async () => {
  const ap = create(opts);
  await ap.setup({prefund: {[a.address]: 10n ** 21n}});
  await settle(ap, await snapRaws(0, 1));
  const dump = await ap.snapshot!();
  const later = (await snapRaws(1, 1))[0]!;
  await settle(ap, [later]);
  await ap.restore!(dump);
  // if the stale receipt survived, this would resolve at once with the old receipt; the node says the tx is unknown
  let settled = false;
  void ap.awaitSettled([keccak256(later)]).then(() => (settled = true));
  await new Promise((r) => setTimeout(r, 20));
  expect(settled).toBe(false);
  await ap.submit([later]);
  await ap.awaitSettled([keccak256(later)]);
  await ap.dispose();
});

test('setup({dump}) on a new instance gives the same head, hash and balances', async () => {
  const one = create(opts);
  await one.setup({prefund: {[a.address]: 10n ** 21n}});
  await settle(one, await snapRaws(0, 3));
  const dump = await one.snapshot!();
  const head = await one.request!('eth_blockNumber');
  const block = await one.request!('eth_getBlockByNumber', [head, false]);
  const bal = await Promise.all([a.address, B].map((x) => one.getBalance(x)));
  await one.dispose();
  const two = create(opts);
  await two.setup({prefund: {}, dump});
  expect(await two.request!('eth_blockNumber')).toBe(head);
  expect(((await two.request!('eth_getBlockByNumber', [head, false])) as any).hash).toBe((block as any).hash);
  expect(await Promise.all([a.address, B].map((x) => two.getBalance(x)))).toEqual(bal);
  await two.dispose();
});

test('persistence: setup({dump}) and restore are durable across open()', async () => {
  const host = {persistence: memPersist()};
  const one = create(opts, host);
  await one.setup({prefund: {[a.address]: 10n ** 21n}});
  await settle(one, await snapRaws(0, 3));
  const dump = await one.snapshot!();
  const head = await one.request!('eth_blockNumber');
  await settle(one, await snapRaws(3, 2));
  await one.restore!(dump);
  await one.dispose();
  const two = create(opts, host);
  await two.open!();
  expect(await two.request!('eth_blockNumber')).toBe(head);
  await two.dispose();

  const host2 = {persistence: memPersist()};
  const three = create(opts, host2);
  await three.setup({prefund: {}, dump});
  await three.dispose();
  const four = create(opts, host2);
  await four.open!();
  expect(await four.request!('eth_blockNumber')).toBe(head);
  await four.dispose();
});

test('pending() counts txs between submit and settled, then 0', async () => {
  const ap = create(opts);
  await ap.setup({prefund: {[a.address]: 10n ** 21n}});
  expect(ap.pending!()).toBe(0);
  const raws = [...(await snapRaws(0, 6)), '0x1234' as Hex]; // one malformed: rejected txs settle too
  await ap.submit(raws);
  expect(ap.pending!()).toBe(7);
  await ap.awaitSettled(raws.map((r) => keccak256(r)));
  expect(ap.pending!()).toBe(0);
  await ap.dispose();
});

test('restore refuses while txs are pending, and they still settle', async () => {
  const ap = create(opts);
  await ap.setup({prefund: {[a.address]: 10n ** 21n}});
  const dump = await ap.snapshot!();
  const raws = await snapRaws(0, 5);
  await ap.submit(raws);
  await expect(ap.restore!(dump)).rejects.toThrow('02-seq-memory: restore refused, 5 txs pending');
  const rs = await ap.awaitSettled(raws.map((r) => keccak256(r)));
  expect(rs.map((r) => r.status)).toEqual(Array(5).fill('success'));
  await ap.dispose();
});

// webevm's loadState does NOT clear its manual-mining queue (`pending`). The pipeline mines every
// queued tx before it settles, so restore() (which requires pending() === 0) never sees a stale queue.
test('after restore the next block holds only new txs', async () => {
  const ap = create(opts);
  await ap.setup({prefund: {[a.address]: 10n ** 21n}});
  const raws = await snapRaws(0, 4);
  await settle(ap, raws.slice(0, 2));
  const dump = await ap.snapshot!();
  await settle(ap, raws.slice(2));
  await ap.restore!(dump);
  await settle(ap, [raws[2]!]);
  const b: any = await ap.request!('eth_getBlockByNumber', ['latest', false]);
  expect(b.transactions).toEqual([keccak256(raws[2]!)]);
  expect(await ap.getBalance(B)).toBe(3n);
  await ap.dispose();
});
