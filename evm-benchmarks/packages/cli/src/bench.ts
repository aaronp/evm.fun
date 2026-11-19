import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {createRevmEngine} from 'webevm/revm';
import {percentile, runBenchmark, scenarios, type ApproachHost} from '@evmb/core';
import {loadApproaches, ROOT} from './approaches.ts';

const median = (a: number[]) => percentile([...a].sort((x, y) => x - y), 50);

export async function bench(argv: string[]) {
  const {values: v} = parseArgs({
    args: argv,
    options: {
      approach: {type: 'string'},
      scenario: {type: 'string'},
      n: {type: 'string', default: '10000'},
      senders: {type: 'string', default: '100'},
      batch: {type: 'string', default: '1000'},
      runs: {type: 'string', default: '3'},
      warmup: {type: 'string', default: '1'},
      seed: {type: 'string', default: crypto.randomUUID().replaceAll('-', '')},
      opt: {type: 'string', multiple: true, default: []},
    },
  });
  if (!v.approach || !v.scenario) throw new Error('usage: bench --approach <id|all> --scenario <id|all> [--n --senders --batch --runs --warmup --seed --opt k=v]');
  const [n, senders, batch, runs, warmup] = [v.n!, v.senders!, v.batch!, v.runs!, v.warmup!].map(Number) as [number, number, number, number, number];
  const opts = Object.fromEntries(v.opt!.map((s) => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));

  if (opts.engine && opts.engine !== 'revm') throw new Error(`unknown engine ${opts.engine}; have: revm`);
  const host: ApproachHost = opts.engine === 'revm' ? {createEngine: () => createRevmEngine({wasm: readFileSync(require.resolve('revm-wasm/revm.wasm'))})} : {};

  const all = await loadApproaches();
  const aIds = v.approach === 'all' ? Object.keys(all) : [v.approach];
  const sIds = v.scenario === 'all' ? Object.keys(scenarios) : [v.scenario];
  for (const id of aIds) if (!all[id]) throw new Error(`unknown approach ${id}; have: ${Object.keys(all).join(', ')}`);
  for (const id of sIds) if (!scenarios[id]) throw new Error(`unknown scenario ${id}; have: ${Object.keys(scenarios).join(', ')}`);

  const dir = process.env.RESULTS_DIR ?? join(ROOT, 'results');
  mkdirSync(dir, {recursive: true});
  const cpu = cpus();
  const ts = new Date().toISOString().replaceAll(':', '-');
  const rows: Record<string, unknown>[] = [];

  for (const a of aIds) {
    for (const s of sIds) {
      const tps: number[] = [];
      const p50: number[] = [];
      const p99: number[] = [];
      let verified = true;
      for (let k = -warmup; k < runs; k++) {
        const approach = all[a]!(opts, host);
        try {
          // distinct seed per run so RPC targets never reuse accounts
          const r = await runBenchmark({approach, scenario: scenarios[s]!(), n, senders, batch, seed: `${v.seed}-r${k < 0 ? `w${-k}` : k + 1}`});
          if (k < 0) continue;
          r.params.opts = opts;
          r.env.cpu = cpu[0]?.model ?? 'unknown';
          r.env.cores = cpu.length;
          writeFileSync(join(dir, `${ts}-${a}-${s}-r${k + 1}.json`), JSON.stringify(r, null, 2));
          verified &&= r.verified;
          if (r.tps !== null) tps.push(r.tps);
          p50.push(r.latencyMs.p50);
          p99.push(r.latencyMs.p99);
        } finally {
          await approach.dispose();
        }
      }
      rows.push({approach: a, scenario: s, 'median TPS': tps.length ? Math.round(median(tps)) : null, 'p50 ms': Math.round(median(p50)), 'p99 ms': Math.round(median(p99)), verified});
    }
  }
  console.table(rows);
}
