import {expect, test} from 'bun:test';
import {encodeFunctionData, getContractAddress} from 'viem';
import {MintableToken} from '@evmb/contracts';
import create from '@evmb/approach-01-webevm-baseline';
import {deriveAccounts, percentile, runBenchmark, scenarios, signTx, type Scenario} from '../src/index.ts';

async function run(id: Scenario['id'], n: number, batch: number, senders = 4, wrap?: (s: Scenario) => Scenario) {
  const approach = create();
  try {
    const scenario = scenarios[id]();
    return await runBenchmark({approach, scenario: wrap ? wrap(scenario) : scenario, n, senders, batch, seed: 'rt'});
  } finally {
    await approach.dispose();
  }
}

test('happy path', async () => {
  const r = await run('eth-transfer', 50, 1000);
  expect(r.verified).toBe(true);
  expect(r.tps).toBeGreaterThan(0);
  expect(r.statuses.success).toBe(50);
  expect(r.latencyMs.p50).toBeLessThanOrEqual(r.latencyMs.p99);
  expect(r.latencyMs.p99).toBeLessThanOrEqual(r.latencyMs.max);
  expect(r.approach.engine).toBe('webevm@0.9.1');
  expect(r.env.engine).toBe('webevm@0.9.1');
}, 60_000);

for (const [n, batch] of [[1, 1000], [7, 3], [50, 50]] as const) {
  test(`odd batch sizes n=${n} batch=${batch}`, async () => {
    const r = await run('eth-transfer', n, batch);
    expect(r.statuses.success).toBe(n);
    expect(r.verified).toBe(true);
  }, 60_000);
}

test('erc20-disjoint n % senders != 0 verifies', async () => {
  const r = await run('erc20-disjoint', 7, 1000, 3);
  expect(r.statuses.success).toBe(7);
  expect(r.verified).toBe(true);
}, 60_000);

test('reverted tx yields null tps', async () => {
  const n = 8;
  const senders = 2;
  const r = await run('erc20-disjoint', n, 1000, senders, (s) => ({
    ...s,
    async generate(p) {
      const raws = await s.generate(p);
      const token = getContractAddress({from: deriveAccounts(p.seed + ':dep', 1)[0]!.address, nonce: 0n});
      const data = encodeFunctionData({abi: MintableToken.abi, functionName: 'transfer', args: [deriveAccounts('x', 1)[0]!.address, 10n ** 30n]});
      // sender 0 sent n/senders txs, so its next nonce is that count
      raws.push(await signTx(deriveAccounts(p.seed, senders)[0]!, n / senders, {to: token, data, gas: 100_000n}));
      return raws;
    },
  }));
  expect(r.statuses.reverted).toBe(1);
  expect(r.statuses.success).toBe(n);
  expect(r.tps).toBeNull();
}, 60_000);

test('percentile nearest-rank', () => {
  expect(percentile([1, 2, 3, 4], 50)).toBe(2);
  expect(percentile([1, 2, 3, 4], 99)).toBe(4);
});

test('keepSamples exposes sorted per-tx latencies; absent by default', async () => {
  const approach = create();
  try {
    const o = {approach, scenario: scenarios['eth-transfer'](), n: 20, senders: 4, seed: 'ks'};
    const r = await runBenchmark({...o, keepSamples: true});
    const s = r.latencySamplesMs!;
    expect(s.length).toBe(20);
    expect([...s].sort((a, b) => a - b)).toEqual(s);
    expect(s[s.length - 1]).toBe(r.latencyMs.max);
    const r2 = await runBenchmark({...o, scenario: scenarios['eth-transfer'](), seed: 'ks2'});
    expect('latencySamplesMs' in r2).toBe(false);
  } finally {
    await approach.dispose();
  }
}, 60_000);
