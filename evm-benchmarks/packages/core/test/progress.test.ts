import {expect, test} from 'bun:test';
import create from '@evmb/approach-01-webevm-baseline';
import {runBenchmark, scenarios} from '../src/index.ts';

test('onProgress reports phases in order and signing reaches n', async () => {
  const calls: [string, number, number][] = [];
  const r = await runBenchmark({
    approach: create(),
    scenario: scenarios['eth-transfer'](),
    n: 250,
    senders: 5,
    seed: 'progress',
    onProgress: (phase, done, total) => calls.push([phase, done, total]),
  });
  expect(r.verified).toBe(true);
  const order = calls.map((c) => c[0]).filter((p, i, a) => a.indexOf(p) === i);
  expect(order).toEqual(['setup', 'signing', 'running', 'verifying']);
  expect(calls.filter((c) => c[0] === 'signing').at(-1)).toEqual(['signing', 250, 250]);
  expect(calls.filter((c) => c[0] === 'signing').length).toBeGreaterThanOrEqual(3); // 0, every 100, end
});
