import {keccak256} from 'viem';
import type {Approach, ApproachMeta, Receipt} from './types.ts';
import type {Scenario} from './scenarios/index.ts';
import {percentile} from './metrics.ts';

export interface RunOptions {
  approach: Approach;
  scenario: Scenario;
  n: number;
  senders: number;
  /** txs per submit call (default 1000) */
  batch?: number;
  seed: string;
}

export interface RunResult {
  approach: ApproachMeta;
  scenario: string;
  params: {n: number; senders: number; batch: number; seed: string; opts?: Record<string, string>};
  signingMs: number;
  durationMs: number;
  tps: number | null;
  latencyMs: {p50: number; p99: number; max: number};
  statuses: Record<Receipt['status'], number>;
  verified: boolean;
  verifyDetail: string;
  phases?: Record<string, number>;
  env: {runtime: string; os: string; cpu: string; cores: number; engine?: string; startedAt: string};
}

function envInfo(engine?: string): RunResult['env'] {
  const g = globalThis as any;
  const nav = g.navigator;
  const proc = g.process;
  return {
    runtime: g.Bun ? `bun@${g.Bun.version}` : proc?.versions?.node ? `node@${proc.versions.node}` : (nav?.userAgent ?? 'unknown'),
    os: proc?.platform ? `${proc.platform}-${proc.arch}` : (nav?.platform ?? 'unknown'),
    cpu: 'unknown', // ponytail: no browser-safe CPU model; CLI may overwrite from node:os
    cores: nav?.hardwareConcurrency ?? 1,
    engine,
    startedAt: new Date().toISOString(),
  };
}

export async function runBenchmark(o: RunOptions): Promise<RunResult> {
  const {approach, scenario, n, senders, seed} = o;
  const batch = o.batch ?? 1000;
  const p = {n, senders, seed};
  const env = envInfo(approach.meta.engine);

  await approach.setup({prefund: scenario.prefund(p)});
  await scenario.setup(approach, p);

  const s0 = performance.now();
  const raws = await scenario.generate(p);
  const signingMs = performance.now() - s0;
  const hashes = raws.map((r) => keccak256(r));

  const submittedAt: number[] = [];
  const t0 = performance.now();
  for (let i = 0; i < raws.length; i += batch) {
    const t = performance.now();
    await approach.submit(raws.slice(i, i + batch));
    for (let j = i; j < Math.min(i + batch, raws.length); j++) submittedAt[j] = t;
  }
  const receipts = await approach.awaitSettled(hashes);

  const durationMs = Math.max(...receipts.map((r) => r.settledAt)) - t0;
  const lat = receipts.map((r, i) => r.settledAt - submittedAt[i]!).sort((a, b) => a - b);
  const statuses = {success: 0, reverted: 0, rejected: 0};
  for (const r of receipts) statuses[r.status]++;

  const v = await scenario.verify(approach, p);
  const ok = v.ok && statuses.success === n && receipts.length === n;
  return {
    approach: approach.meta,
    scenario: scenario.id,
    params: {n, senders, batch, seed},
    signingMs,
    durationMs,
    tps: ok ? n / (durationMs / 1000) : null,
    latencyMs: {p50: percentile(lat, 50), p99: percentile(lat, 99), max: lat[lat.length - 1] ?? 0},
    statuses,
    verified: v.ok,
    verifyDetail: v.detail,
    phases: approach.phases?.(),
    env,
  };
}
