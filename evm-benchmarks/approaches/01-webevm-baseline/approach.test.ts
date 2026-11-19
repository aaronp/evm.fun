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
