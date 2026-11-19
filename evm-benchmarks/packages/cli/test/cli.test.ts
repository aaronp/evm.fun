import {expect, test} from 'bun:test';
import {mkdtempSync, readdirSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('bench writes one verified result and exits 0', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'evmb-'));
  const p = Bun.spawn(
    ['bun', 'packages/cli/src/main.ts', 'bench', '--approach', '01-webevm-baseline', '--scenario', 'eth-transfer', '--n', '20', '--runs', '1', '--warmup', '0'],
    {cwd: join(import.meta.dir, '../../..'), env: {...process.env, RESULTS_DIR: dir}, stdout: 'ignore', stderr: 'pipe'},
  );
  expect(await p.exited).toBe(0);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  expect(files).toHaveLength(1);
  expect(JSON.parse(readFileSync(join(dir, files[0]!), 'utf8')).verified).toBe(true);
}, 30_000);
