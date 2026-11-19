import {expect, test} from 'bun:test';
import type {RunResult} from '@evmb/core';
import {renderReport} from '../src/report.ts';
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
