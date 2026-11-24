// Put the worker live on your Cloudflare account and create the root chain: make deploy
// Needs `wrangler login` (once) and .env.live with ROOT_ADMIN_KEY; refuses to generate a key. Run by Aaron, never by CI.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { privateKeyToAccount } from 'viem/accounts'
import { NodeClient } from '../src/client'
import { bootstrap } from './bootstrap'

const PKG = join(import.meta.dir, '..')
const ENV = join(PKG, '../../.env.live')
const DOMAIN = 'cloud.mychain.dev'

const key = existsSync(ENV) ? readFileSync(ENV, 'utf8').match(/^ROOT_ADMIN_KEY=(0x[0-9a-fA-F]{64})\s*$/m)?.[1] : undefined
if (!key) throw new Error('.env.live needs ROOT_ADMIN_KEY=0x… (your root admin key); this script does not generate one for the live worker')
const admin = privateKeyToAccount(key as `0x${string}`).address

// keep the key out of wrangler's environment; only the address goes up (--var)
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ROOT_ADMIN_KEY'))
const proc = Bun.spawn([join(PKG, 'node_modules/.bin/wrangler'), 'deploy', '--env', 'live', '--var', `ROOT_ADMIN:${admin}`], {
  cwd: PKG, env, stdin: 'inherit', stdout: 'pipe', stderr: 'inherit',
})
const out = await new Response(proc.stdout).text()
process.stdout.write(out)
if ((await proc.exited) !== 0) throw new Error('wrangler deploy failed')

// custom domain if wrangler deployed to it, else the workers.dev URL it printed
const url = out.includes(DOMAIN) ? `https://${DOMAIN}` : out.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0]
if (!url) throw new Error('deployed, but could not find the worker URL in wrangler output')

// a fresh custom domain can take a moment to answer
for (let i = 0; ; i++) {
  try {
    await new NodeClient(url, privateKeyToAccount(key as `0x${string}`)).health()
    break
  } catch (e) {
    if (i >= 15) throw e
    await Bun.sleep(2000)
  }
}
await bootstrap(url, ENV)
const { root } = await new NodeClient(url, privateKeyToAccount(key as `0x${string}`)).health()
console.log(`\nworker: ${url}\nroot chain id: root (admin ${root!.admin})\nset GitHub repo variable NODE_URL to ${url}`)
