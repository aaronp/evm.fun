import {expect, test} from 'bun:test';
import {keccak256} from 'viem';
import create from '@evmb/approach-01-webevm-baseline';
import {deriveAccounts, scenarios, type ScenarioParams} from '../src/index.ts';

const p: ScenarioParams = {n: 40, senders: 8, seed: 'test'};

for (const id of Object.keys(scenarios) as (keyof typeof scenarios)[]) {
  test(`${id}: runs and verifies`, async () => {
    const ap = create();
    const sc = scenarios[id]();
    await ap.setup({prefund: sc.prefund(p)});
    await sc.setup(ap, p);
    const raws = await sc.generate(p);
    expect(raws.length).toBe(p.n);
    await ap.submit(raws);
    const rs = await ap.awaitSettled(raws.map((r) => keccak256(r)));
    expect(rs.map((r) => r.status)).toEqual(Array(p.n).fill('success'));
    const v = await sc.verify(ap, p);
    expect(v.detail).toBeString();
    expect(v.ok).toBe(true);
    await ap.dispose();
  }, 60_000);
}

test('verify fails when txs not submitted', async () => {
  const ap = create();
  const sc = scenarios['erc20-disjoint']();
  await ap.setup({prefund: sc.prefund(p)});
  await sc.setup(ap, p);
  await sc.generate(p);
  expect((await sc.verify(ap, p)).ok).toBe(false);
  await ap.dispose();
});

test('deriveAccounts is deterministic', () => {
  expect(deriveAccounts('s', 3).map((a) => a.address)).toEqual(deriveAccounts('s', 3).map((a) => a.address));
});

for (const id of ['erc20-disjoint', 'erc20-hot', 'atomic-swap'] as const) {
  test(`${id}: verify fails when last tx missing`, async () => {
    const ap = create();
    const sc = scenarios[id]();
    await ap.setup({prefund: sc.prefund(p)});
    await sc.setup(ap, p);
    const raws = (await sc.generate(p)).slice(0, -1);
    await ap.submit(raws);
    await ap.awaitSettled(raws.map((r) => keccak256(r)));
    expect((await sc.verify(ap, p)).ok).toBe(false);
    await ap.dispose();
  }, 60_000);
}
