// Local chain worker in the background: bun packages/node/scripts/dev-services.ts start|status|stop
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { privateKeyToAccount } from 'viem/accounts'
import { NodeClient } from '../src/client'
import { bootstrap, ensureKey } from './bootstrap'

const PKG = join(import.meta.dir, '..')
const ROOT = join(PKG, '../..')
const RUN = join(ROOT, '.run')
const ENV = join(ROOT, '.env.local')
const PID = join(RUN, 'node.pid')
const LOG = join(RUN, 'node.log')
const PORT = 8799
const URL_ = `http://127.0.0.1:${PORT}`

/** The recorded pid if that process is alive; a stale pid file is removed. */
function pid(): number | null {
  if (!existsSync(PID)) return null
  const p = Number(readFileSync(PID, 'utf8'))
  try {
    process.kill(p, 0)
    return p
  } catch {
    // ESRCH: gone; EPERM: someone else's process now holds that pid. Either way not ours, not running.
    rmSync(PID, { force: true })
    return null
  }
}

/** The pid's command line, or null if `ps` can't tell (e.g. a sandbox that forbids it). */
function command(p: number): string | null {
  try {
    const r = Bun.spawnSync(['ps', '-o', 'command=', '-p', String(p)])
    return r.success ? r.stdout.toString().trim() : null
  } catch {
    return null
  }
}

const alive = (p: number) => { try { process.kill(p, 0); return true } catch { return false } }

/** SIGTERM wrangler's process group (wrangler alone would orphan workerd), wait for it to exit, then SIGKILL. */
async function kill(p: number): Promise<string> {
  const cmd = command(p)
  // ponytail: if ps is unavailable, trust the pid file only while our worker answers /health on its port
  const ours = cmd === null ? !!(await health()) : /wrangler|workerd/.test(cmd)
  if (!ours) return `pid ${p} is not wrangler (${cmd ?? 'unknown command'}); not signalled`
  const signal = (sig: NodeJS.Signals) => { try { process.kill(-p, sig) } catch { try { process.kill(p, sig) } catch {} } }
  signal('SIGTERM')
  for (let i = 0; i < 100 && alive(p); i++) await Bun.sleep(100)
  if (alive(p)) {
    signal('SIGKILL')
    for (let i = 0; i < 20 && alive(p); i++) await Bun.sleep(100)
  }
  return alive(p) ? `pid ${p} still running (not permitted to stop it?)` : `stopped (pid ${p})`
}

const health = () => new NodeClient(URL_).health().catch(() => null)

async function status() {
  const p = pid()
  if (!p) return console.log('node: not running')
  const h = await health()
  console.log(`node: running, pid ${p}, port ${PORT}, ${URL_}`)
  console.log(`  health: ${h ? 'ok' : 'not answering'}`)
  if (h) console.log(`  root chain: ${h.root ? `head #${h.root.head}, admin ${h.root.admin}` : 'not created'}`)
}

async function start() {
  if (pid()) {
    console.log('node: already running')
    return status()
  }
  const admin = privateKeyToAccount(ensureKey(ENV).key).address
  mkdirSync(RUN, { recursive: true })
  // bun auto-loads .env.local into process.env: keep its values (the root admin key) away from wrangler
  const secret = new Set([...(existsSync(ENV) ? readFileSync(ENV, 'utf8').matchAll(/^(\w+)=/gm) : [])].map((m) => m[1]!))
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !secret.has(k) && k !== 'ROOT_ADMIN_KEY'))
  const wrangler = join(PKG, 'node_modules/.bin/wrangler')
  // detached: wrangler leads its own process group, so stop can kill it together with workerd
  const proc = Bun.spawn([wrangler, 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', join(RUN, 'node-state'), '--var', `ROOT_ADMIN:${admin}`], {
    cwd: PKG, detached: true, stdin: 'ignore', stdout: Bun.file(LOG), stderr: Bun.file(LOG),
    env: { ...env, WRANGLER_LOG_PATH: join(RUN, 'wrangler-logs'), WRANGLER_SEND_METRICS: 'false', XDG_CONFIG_HOME: join(RUN, 'xdg') },
  })
  proc.unref()
  writeFileSync(PID, String(proc.pid))
  try {
    for (let i = 0; i < 600 && !(await health()); i++) {
      if (proc.exitCode !== null) throw new Error(`wrangler dev exited (${proc.exitCode}); see ${LOG}`)
      await Bun.sleep(100)
    }
    if (!(await health())) throw new Error(`wrangler dev did not answer /health within 60 s; see ${LOG}`)
    console.log(`node: started, pid ${proc.pid}, ${URL_} (log ${LOG})`)
    console.log(`  root admin: ${admin}`)
    await bootstrap(URL_, ENV)
  } catch (e) {
    console.log(`node: start failed, ${await kill(proc.pid)}`)
    rmSync(PID, { force: true })
    throw e
  }
}

async function stop() {
  const p = pid()
  if (!p) return console.log('node: not running')
  const r = await kill(p)
  if (!r.includes('still running')) rmSync(PID, { force: true })
  console.log(`node: ${r}`)
}

const cmd = process.argv[2]
if (cmd === 'start') await start()
else if (cmd === 'status') await status()
else if (cmd === 'stop') await stop()
else throw new Error('usage: dev-services.ts start|status|stop')
