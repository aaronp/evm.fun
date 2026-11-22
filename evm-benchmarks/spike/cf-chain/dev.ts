// Start/stop `wrangler dev` for the demos (local workerd only, no login).
import { join } from 'node:path'

const tmp = process.env.TMPDIR ?? '/tmp'

export async function startWrangler(dir: string, port: number, persist: string) {
  const base = `http://127.0.0.1:${port}`
  const t0 = performance.now()
  const p = Bun.spawn([`${process.env.HOME}/.bun/bin/wrangler`, 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist], {
    cwd: dir, detached: true, stdout: Bun.file(join(tmp, 'cf-chain-wrangler.log')), stderr: Bun.file(join(tmp, 'cf-chain-wrangler.err')),
    env: { ...process.env, WRANGLER_LOG_PATH: join(tmp, 'wrangler-logs'), WRANGLER_SEND_METRICS: 'false', XDG_CONFIG_HOME: join(tmp, 'xdg') },
  })
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(base); if ((await r.text()).includes('"not found"')) { console.log(`wrangler dev up in ${(performance.now() - t0).toFixed(0)} ms`); return p } } catch {}
    await Bun.sleep(100)
  }
  p.kill()
  throw new Error(`wrangler dev did not come up; see ${tmp}/cf-chain-wrangler.err`)
}

// SIGTERM to wrangler alone orphans workerd, so wrangler runs in its own process group and we kill the group
export async function stopWrangler(p: Bun.Subprocess, port: number) {
  process.kill(-p.pid, 'SIGTERM')
  await p.exited
  for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}`) } catch { return } await Bun.sleep(100) }
  throw new Error('wrangler dev still serving after stop')
}
