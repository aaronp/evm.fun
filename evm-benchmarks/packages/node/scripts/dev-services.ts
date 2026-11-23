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
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') return p // alive, just not ours to signal
    rmSync(PID, { force: true })
    return null
  }
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
  const wrangler = join(PKG, 'node_modules/.bin/wrangler')
  // detached: wrangler leads its own process group, so stop can kill it together with workerd
  const proc = Bun.spawn([wrangler, 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', join(RUN, 'node-state'), '--var', `ROOT_ADMIN:${admin}`], {
    cwd: PKG, detached: true, stdin: 'ignore', stdout: Bun.file(LOG), stderr: Bun.file(LOG),
    env: { ...process.env, WRANGLER_LOG_PATH: join(RUN, 'wrangler-logs'), WRANGLER_SEND_METRICS: 'false', XDG_CONFIG_HOME: join(RUN, 'xdg') },
  })
  proc.unref()
  writeFileSync(PID, String(proc.pid))
  for (let i = 0; i < 600 && !(await health()); i++) {
    if (proc.exitCode !== null) throw new Error(`wrangler dev exited (${proc.exitCode}); see ${LOG}`)
    await Bun.sleep(100)
  }
  if (!(await health())) throw new Error(`wrangler dev did not answer /health within 60 s; see ${LOG}`)
  console.log(`node: started, pid ${proc.pid}, ${URL_} (log ${LOG})`)
  console.log(`  root admin: ${admin}`)
  await bootstrap(URL_, ENV)
}

async function stop() {
  const p = pid()
  if (!p) return console.log('node: not running')
  try { process.kill(-p, 'SIGTERM') } catch { process.kill(p, 'SIGTERM') }
  for (let i = 0; i < 100 && (await health()); i++) await Bun.sleep(100)
  rmSync(PID, { force: true })
  console.log(`node: stopped (pid ${p})`)
}

const cmd = process.argv[2]
if (cmd === 'start') await start()
else if (cmd === 'status') await status()
else if (cmd === 'stop') await stop()
else throw new Error('usage: dev-services.ts start|status|stop')
