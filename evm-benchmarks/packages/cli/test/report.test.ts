import {expect, test} from 'bun:test';
import type {RunResult} from '@evmb/core';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderReport, report} from '../src/report.ts';
import fixture from './fixtures/results.json';

const results = fixture as unknown as RunResult[];

test('median uses verified runs only; zero verified shows a dash', () => {
  const md = renderReport(results, '');
  expect(md).toMatch(/\| a-fast \| eng@1 \| 1,000 \|/);
  expect(md).toMatch(/\| b-slow \| eng@2 \| — \|/);
  expect(md).toContain('| 3/3 |');
  expect(md).toContain('| 0/2 |');
});

test('target line lists only approaches at or above 1000', () => {
  expect(renderReport(results, '')).toContain('Target: 1,000 TPS — ✅ met by: a-fast');
  expect(renderReport(results.filter((r) => r.approach.id === 'b-slow'), '')).toContain('Target: 1,000 TPS — ❌ not met');
});

test('header uses the newest result env; notes are kept verbatim', () => {
  const md = renderReport(results, 'my  notes\n- x');
  expect(md).toContain('Test CPU');
  expect(md).toContain('<!-- notes -->\nmy  notes\n- x');
});

test('smaller-n results are excluded and disclosed in the header', () => {
  const small = results.slice(0, 2).map((r) => ({...r, params: {...r.params, n: 2000}}));
  const md = renderReport(results, '', small);
  expect(md).toContain('Excluded 2 results with n≠10000 (n=2000: 2)');
  expect(renderReport(results, '')).not.toContain('Excluded');
});

test('report() keeps notes across regeneration and excludes smaller n', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evmb-rep-'));
  results.forEach((r, i) => writeFileSync(join(dir, `${i}.json`), JSON.stringify(i === 0 ? {...r, params: {...r.params, n: 2000}} : r)));
  const out = join(dir, 'REPORT.md');
  report(dir, out);
  writeFileSync(out, readFileSync(out, 'utf8') + 'hand written\n');
  report(dir, out);
  const md = readFileSync(out, 'utf8');
  expect(md).toContain('<!-- notes -->\nhand written\n');
  expect(md.match(/hand written/g)).toHaveLength(1);
  expect(md).toContain('Excluded 1 results with n≠10000 (n=2000: 1)');
});
