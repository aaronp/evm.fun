import {expect, test} from 'bun:test';
import {keccak256} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {readFileSync} from 'node:fs';
import {createRevmEngine} from 'webevm/revm';
import type {Hex} from '@evmb/core';
import create from './index.ts';

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

test('settles a signed transfer', async () => {
  const ap = create();
  await ap.setup({prefund: {[a.address]: 10n ** 24n}});
  const raw = await sign(0);
  await ap.submit([raw]);
  const rs = await ap.awaitSettled([keccak256(raw)]);
  expect(rs[0]?.status).toBe('success');
  expect(await ap.getBalance(B)).toBe(1n);
  await ap.dispose();
});

test('setup resets state', async () => {
  const ap = create();
  await ap.setup({prefund: {[a.address]: 10n ** 24n}});
  await ap.submit([await sign(0)]);
  expect(await ap.getBalance(B)).toBe(1n);
  await ap.setup({prefund: {[a.address]: 10n ** 24n}});
  expect(await ap.getBalance(B)).toBe(0n);
  await ap.dispose();
});

test('garbage raw tx is rejected', async () => {
  const ap = create();
  await ap.setup({prefund: {}});
  await ap.submit(['0x1234']);
  const [r] = await ap.awaitSettled([keccak256('0x1234' as Hex)]);
  expect(r?.status).toBe('rejected');
  expect(typeof r?.error).toBe('string');
  await ap.dispose();
});

const memoryPersistence = () => {
  let saved: any = null;
  return {load: async () => saved, save: async (s: any) => void (saved = structuredClone(s))};
};
const rpc = (ap: ReturnType<typeof create>, m: string, p: unknown[] = []) => ap.request!(m, p) as Promise<any>;

test('request passes reads through to the node', async () => {
  const ap = create();
  await ap.setup({prefund: {[a.address]: 10n ** 24n}});
  await ap.submit([await sign(0)]);
  await ap.awaitSettled([keccak256(await sign(0))]);
  expect(await rpc(ap, 'eth_blockNumber')).toBe('0x1');
  await ap.dispose();
});

test('revm engine + persistence: open() restores history and balances', async () => {
  const wasm = readFileSync(require.resolve('revm-wasm/revm.wasm'));
  const host = {createEngine: () => createRevmEngine({wasm}), persistence: memoryPersistence()};
  const one = create({}, host);
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

  const two = create({}, host);
  await two.open!();
  expect(await Promise.all([a.address, B].map((x) => two.getBalance(x)))).toEqual(bal);
  expect(await rpc(two, 'eth_getTransactionReceipt', [keccak256(raws[1]!)])).toEqual(receipt);
  expect(await rpc(two, 'eth_blockNumber')).toBe(head);
  await two.dispose();
});

test('open() throws when nothing was persisted', async () => {
  const ap = create({}, {persistence: memoryPersistence()});
  await expect(ap.open!()).rejects.toThrow(/nothing persisted/);
  await ap.dispose();
});

test('setup() makes the reset durable before any tx', async () => {
  const host = {persistence: memoryPersistence()};
  const one = create({}, host);
  await one.setup({prefund: {[a.address]: 10n ** 21n}});
  await one.submit([await sign(0)]);
  await one.awaitSettled([keccak256(await sign(0))]);
  await one.dispose();
  const two = create({}, host);
  await two.setup({prefund: {[a.address]: 7n}});
  await two.dispose();
  const three = create({}, host);
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
  const ap = create();
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
  const ap = create();
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
  const one = create();
  await one.setup({prefund: {[a.address]: 10n ** 21n}});
  await settle(one, await snapRaws(0, 3));
  const dump = await one.snapshot!();
  const head = await one.request!('eth_blockNumber');
  const block = await one.request!('eth_getBlockByNumber', [head, false]);
  const bal = await Promise.all([a.address, B].map((x) => one.getBalance(x)));
  await one.dispose();
  const two = create();
  await two.setup({prefund: {}, dump});
  expect(await two.request!('eth_blockNumber')).toBe(head);
  expect(((await two.request!('eth_getBlockByNumber', [head, false])) as any).hash).toBe((block as any).hash);
  expect(await Promise.all([a.address, B].map((x) => two.getBalance(x)))).toEqual(bal);
  await two.dispose();
});

test('persistence: setup({dump}) and restore are durable across open()', async () => {
  const host = {persistence: memPersist()};
  const one = create({}, host);
  await one.setup({prefund: {[a.address]: 10n ** 21n}});
  await settle(one, await snapRaws(0, 3));
  const dump = await one.snapshot!();
  const head = await one.request!('eth_blockNumber');
  await settle(one, await snapRaws(3, 2));
  await one.restore!(dump);
  await one.dispose();
  const two = create({}, host);
  await two.open!();
  expect(await two.request!('eth_blockNumber')).toBe(head);
  await two.dispose();

  const host2 = {persistence: memPersist()};
  const three = create({}, host2);
  await three.setup({prefund: {}, dump});
  await three.dispose();
  const four = create({}, host2);
  await four.open!();
  expect(await four.request!('eth_blockNumber')).toBe(head);
  await four.dispose();
});

test('pending() is 0 for the baseline', async () => {
  const ap = create();
  await ap.setup({prefund: {[a.address]: 10n ** 21n}});
  expect(ap.pending!()).toBe(0);
  await ap.dispose();
});

test('restore wakes an in-flight awaitSettled instead of orphaning it', async () => {
  const ap = create();
  await ap.setup({prefund: {[a.address]: 10n ** 21n}});
  const dump = await ap.snapshot!();
  const raw = await sign(0);
  let done = false;
  const p = ap.awaitSettled([keccak256(raw)]).then(() => (done = true));
  await ap.restore!(dump);
  await ap.submit([raw]);
  await p;
  expect(done).toBe(true);
  await ap.dispose();
});

// C1: webevm's loadState only puts the dump's accounts/code/storage, so restore must start a fresh node.
const C = '0x00000000000000000000000000000000000c0ffe' as const;
// constructor: SSTORE(0, 0x2a); runtime code 0xff
const INIT = '0x602a60005560ff60005360016000f3' as const;
const signAny = (nonce: number, extra: {to?: Hex; value?: bigint; data?: Hex}) =>
  a.signTransaction({
    type: 'eip1559',
    chainId: 31337,
    nonce,
    gas: 100_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    ...extra,
  });

test('restore replaces state: an account funded and a contract deployed after the snapshot are gone', async () => {
  const ap = create({}, {persistence: memPersist()});
  await ap.setup({prefund: {[a.address]: 10n ** 21n}});
  await settle(ap, await snapRaws(0, 1));
  const dump = await ap.snapshot!();
  const [, deploy] = await settle(ap, [await signAny(1, {to: C, value: 5n}), await signAny(2, {data: INIT})]);
  const K = deploy!.contractAddress!;
  expect(await ap.getBalance(C)).toBe(5n);
  expect(await ap.request!('eth_getCode', [K, 'latest'])).toBe('0xff');
  await ap.restore!(dump);
  expect(await ap.getBalance(C)).toBe(0n);
  expect(await ap.request!('eth_getCode', [K, 'latest'])).toBe('0x');
  expect(BigInt((await ap.request!('eth_getStorageAt', [K, '0x0', 'latest'])) as string)).toBe(0n);
  await ap.dispose();
});

test('a send in flight across restore settles (rejected) instead of hanging', async () => {
  const ap = create();
  await ap.setup({prefund: {[a.address]: 10n ** 21n}});
  const dump = await ap.snapshot!();
  const raw = await sign(0);
  const sent = ap.submit([raw]);
  await ap.restore!(dump);
  await sent;
  const [r] = await ap.awaitSettled([keccak256(raw)]);
  expect(['rejected', 'success']).toContain(r!.status);
  expect(await ap.getBalance(B)).toBe(0n);
  await ap.dispose();
});
