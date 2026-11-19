import {expect, test} from 'bun:test';
import {keccak256} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
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
