import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import type {ApproachFactory} from '@evmb/core';

export const ROOT = join(import.meta.dir, '../../..');

/** Scans approaches/*\/index.ts; keyed by meta.id (a throwaway instance is built to read it). */
export async function loadApproaches(): Promise<Record<string, ApproachFactory>> {
  const dir = join(ROOT, 'approaches');
  const out: Record<string, ApproachFactory> = {};
  for (const d of readdirSync(dir).sort()) {
    const f = join(dir, d, 'index.ts');
    if (!(await Bun.file(f).exists())) continue;
    const factory = (await import(f)).default as ApproachFactory;
    out[factory().meta.id] = factory;
  }
  return out;
}
