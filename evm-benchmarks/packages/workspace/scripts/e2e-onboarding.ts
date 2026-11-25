// Onboarding end-to-end through @evmb/workspace, against the running local worker (make e2e-node runs it after the node e2e).
//   bun packages/workspace/scripts/e2e-onboarding.ts [url]
import { join } from 'node:path'
import { keccak256, toBytes, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { BrowserKeyStore, MemoryKeyPersistence, passphraseProvider } from '@evmb/keys'
import { NodeClient, NodeError, ensureOnboarding, setupTxs } from '@evmb/node'
import { ensureKey, freshDump, wasm } from '../../node/scripts/bootstrap'
import { MemoryWorkspaceStorage, Workspace } from '../src'

const URL_ = process.argv[2] ?? 'http://127.0.0.1:8799'
const ENV = join(import.meta.dir, '../../../.env.local')
const IP = `e2e-onb-${crypto.randomUUID()}` // own rate-limit bucket per run: this run's refused redeems count only here

let failures = 0
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`)
  if (!ok) failures++
}
const realFetch = fetch
globalThis.fetch = ((u: RequestInfo | URL, init: RequestInit = {}) =>
  realFetch(u, { ...init, headers: { ...(init.headers as Record<string, string>), 'cf-connecting-ip': IP } })) as typeof fetch
/** The error a promise rejects with ('' if it resolves). */
const refusal = (p: Promise<unknown>) => p.then(() => '', (e) => (e instanceof NodeError ? `${e.status} ${e.error}` : (e as Error).message))

const adminKey = ensureKey(ENV).key, admin = privateKeyToAccount(adminKey)
const sueKey = generatePrivateKey(), sue = privateKeyToAccount(sueKey)
const bob = privateKeyToAccount(generatePrivateKey())
const persistence = new MemoryKeyPersistence()
const keys = new BrowserKeyStore({ persistence, provider: passphraseProvider({ persistence, ask: async () => 'e2e' }) })
const sueStorage = new MemoryWorkspaceStorage()
const open = (me: Address, storage = new MemoryWorkspaceStorage()) => Workspace.open({ workerUrl: URL_, keys, me, storage, wasm })

try {
  await ensureOnboarding(new NodeClient(URL_, admin), admin)
  await keys.importKey(adminKey)
  await keys.importKey(sueKey)
  const a = await open(admin.address)
  let s = await open(sue.address, sueStorage)
  check(await a.isIssuer(), 'onboarding (workspace): the root admin is an issuer')
  check(!(await s.isIssuer()), 'a fresh key (Sue) is not')

  const typed = `let-sue-${crypto.randomUUID().slice(0, 6)}` // LET-SUE-IN-style, unique per run
  const { code } = await a.issueCode({ code: typed, label: 'e2e: Sue', validFor: '1h', uses: 2 })
  check(code === typed.replace(/-/g, '').toUpperCase(), `admin issues typed code ${typed} for 2 uses (stored as ${code})`)

  const first = await s.deploy((await s.createChain('Sue 1', '')).id, { code: typed })
  const info = await new NodeClient(URL_, sue).info(first.id)
  check(first.status === 'deployed' && info.admin === sue.address, 'Sue creates a chain and deploys it with the code; she is its admin')

  const bobCreates = async (chainId: string) => refusal(new NodeClient(URL_, bob).createChain({ chainId, dump: await freshDump(), setup: await setupTxs(bob, 0, 31337) }))
  const taken = await bobCreates(first.id)
  check(taken === '409 chain already exists', `Bob can't create Sue's deployed chain id (${taken})`)

  // a grant with no chain yet: Sue's create fails after the redeem (a dump the worker refuses), so her deploy is unfinished
  const { code: once } = await a.issueCode({ label: 'e2e: unfinished', validFor: '10m', uses: 1 })
  const rec = await s.createChain('Sue unfinished', '')
  await sueStorage.save({ ...rec, dump: { ...rec.dump!, chainId: 1 } }) // loads locally; the worker refuses its set-up txs (signed for 31337)
  s = await open(sue.address, sueStorage)
  const failed = await refusal(s.deploy(rec.id, { code: once }))
  check(s.chains().find((c) => c.id === rec.id)?.status === 'unfinished', `a create failing after the redeem → unfinished (${failed.split("\n")[0]})`)
  const granted = await bobCreates(rec.id)
  check(granted === '403 not allowed to create this chain', `Bob can't create the chain id Sue was granted (${granted})`)
  await sueStorage.save({ ...s.chains().find((c) => c.id === rec.id)!, dump: rec.dump })
  s = await open(sue.address, sueStorage)
  const retried = await s.retryDeploy(rec.id)
  check(retried.status === 'deployed' && (await new NodeClient(URL_, sue).info(rec.id)).admin === sue.address, 'Sue\'s retryDeploy creates it; she is its admin')
  const spent = (await a.codes()).find((c) => c.hash === keccak256(toBytes(once)))
  check(spent?.usesLeft === 0 && spent.grants.length === 1, 'the use was spent once')

  const second = await s.deploy((await s.createChain('Sue 2', '')).id, { code })
  check(second.status === 'deployed', "Sue's second deploy uses the second use")
  const view = (await a.codes()).find((c) => c.hash === keccak256(toBytes(code)))
  check(view?.status === 'used' && view.usesLeft === 0 && view.grants.map((g) => g.chainId).join() === [first.id, second.id].join()
    && view.grants.every((g) => g.by === sue.address), 'codes(): used, 0 left, both grants Sue\'s')

  const third = await refusal(s.deploy((await s.createChain('Sue 3', '')).id, { code }))
  check(third === 'code used up', `a third deploy → "${third}"`)

  const { code: fresh } = await a.issueCode({ label: 'e2e: revoked', validFor: '10m', uses: 1 })
  await a.revokeCode(keccak256(toBytes(fresh)))
  const revoked = await refusal(s.deploy((await s.createChain('Sue 4', '')).id, { code: fresh }))
  check(revoked === 'code revoked', `revoke a fresh code → deploy with it → "${revoked}"`)
} catch (e) {
  check(false, `unexpected: ${(e as Error).message}`)
}

console.log(failures ? `${failures} FAILED` : 'ALL PASS')
process.exit(failures ? 1 : 0)
