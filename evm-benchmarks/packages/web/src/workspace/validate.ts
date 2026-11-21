import { privateKeyToAccount } from 'viem/accounts'
import { bookSchema } from '@evmb/orderbook'
import { decodeChainFile, encodeJson, MAX_NAME, parseJson } from '../chain/chainFile'
import { validate as validateWalkthrough } from '../walkthrough/validate'
import type { WorkspaceFile } from './types'

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const str = (v: unknown) => isStr(v) && v.length <= MAX_NAME
const hex = (n: number) => (v: unknown) => isStr(v) && new RegExp(`^0x[0-9a-fA-F]{${n}}$`).test(v)
const isAddr = hex(40), isKey = hex(64)
/** Chain and snapshot ids become IndexedDB names, kv keys and `?chain=` values: plain tokens only. */
const isId = (v: unknown) => isStr(v) && /^[A-Za-z0-9_-]{1,100}$/.test(v)
// Untrusted names are quoted, clipped and never interpolated raw.
const name = (v: unknown, fallback: string) => (isStr(v) ? JSON.stringify(v.slice(0, 40)) : fallback)

/** The text as a workspace file, or every problem found. Any error refuses the whole file. */
export function validateWorkspace(text: string, opts: { engine: string; crossEngineOk: boolean }): { ok: WorkspaceFile } | { errors: string[] } {
  try { return check(text, opts) } catch { return { errors: ['Invalid file'] } }
}

function check(text: string, opts: { engine: string; crossEngineOk: boolean }): { ok: WorkspaceFile } | { errors: string[] } {
  const p = parseJson(text)
  if ('error' in p) return { errors: [p.error] }
  const f = p.value as any
  if (!isObj(f)) return { errors: ['Not a workspace file: expected a JSON object'] }
  if (f.format !== 'evm.fun/workspace') return { errors: ['Wrong format: expected "evm.fun/workspace"'] }
  if (typeof f.version === 'number' && f.version > 1) return { errors: ['Unsupported version: made by a newer version of evm.fun'] }
  if (f.version !== 1) return { errors: ['Missing or invalid version: expected 1'] }

  const errors: string[] = []
  const bad = (e: string) => void errors.push(e)
  if (!isStr(f.savedAt)) bad('Missing or invalid savedAt')
  if (!isStr(f.engine)) bad('Missing or invalid engine')
  for (const k of ['accounts', 'chains', 'snapshots', 'orderbook']) if (!Array.isArray(f[k])) bad(`Missing or invalid ${k}: expected an array`)
  if (!isObj(f.walkthroughs) || !Array.isArray(f.walkthroughs.edits) || !Array.isArray(f.walkthroughs.runs))
    bad('Missing or invalid walkthroughs: expected { edits: [], runs: [] }')
  if (f.activeWalkthrough !== undefined && !str(f.activeWalkthrough)) bad('Invalid activeWalkthrough')
  if (errors.length) return { errors }

  const addrs = new Set<string>()
  f.accounts.forEach((a: any, i: number) => {
    const at = `accounts[${i}]`
    if (!isObj(a)) return bad(`${at} is not an object`)
    if (!str(a.label)) return bad(`${at}.label is not a string of at most ${MAX_NAME} characters`)
    if (!isAddr(a.address)) return bad(`${at}.address is not an address`)
    if (!isKey(a.privateKey)) return bad(`${at}.privateKey is not a 32-byte hex key`)
    if (privateKeyToAccount(a.privateKey).address.toLowerCase() !== a.address.toLowerCase()) return bad(`${at}.privateKey does not match its address`)
    if (addrs.has(a.address.toLowerCase())) return bad(`${at} is a duplicate of another account`)
    addrs.add(a.address.toLowerCase())
  })

  const chains = new Map<string, any>() // id → decoded chain file
  f.chains.forEach((c: any, i: number) => {
    const label = `Chain ${name(c?.chain?.name, `chains[${i}]`)}`
    if (!isObj(c)) return bad(`chains[${i}] is not an object`)
    if (!isId(c.id)) return bad(`${label}: invalid id`)
    if (chains.has(c.id)) return bad(`${label}: duplicate chain id ${c.id}`)
    const { id, ...file } = c
    const d = decodeChainFile(encodeJson(file), opts)
    if (!d.ok) return bad(`${label}: ${d.error}`)
    chains.set(id, { ...d.file, id })
  })

  const snapIds = new Set<string>()
  f.snapshots.forEach((s: any, i: number) => {
    const at = `snapshots[${i}]`
    if (!isObj(s)) return bad(`${at} is not an object`)
    if (!isId(s.id) || snapIds.has(s.id)) return bad(`${at}.id is missing, invalid or a duplicate`)
    snapIds.add(s.id)
    const chain = chains.get(s.chainId)
    if (!chain) return bad(`${at} belongs to a chain not in this file`)
    if (!str(s.name) || !isStr(s.createdAt) || !Number.isInteger(s.height) || s.height < 0 || typeof s.bytes !== 'number')
      return bad(`${at} needs name, createdAt, height and bytes`)
    if (!Array.isArray(s.assets)) return bad(`${at}.assets is not an array`)
    // its dump, contracts and assets are checked as a chain file of its chain
    const d = decodeChainFile(encodeJson({ ...chain, id: undefined, dump: s.dump, contracts: s.contracts, assets: s.assets, source: undefined }), opts)
    if (!d.ok) bad(`${at} (${name(s.name, 'unnamed')}): ${d.error}`)
  })

  f.walkthroughs.edits.forEach((w: any, i: number) => {
    const r = validateWalkthrough(w)
    if ('errors' in r) bad(`walkthroughs.edits[${i}]: ${r.errors.map(e => `${e.step ? `${e.step} · ` : ''}${e.field} — ${e.message}`).join('; ')}`)
  })
  f.walkthroughs.runs.forEach((r: any, i: number) => {
    if (!isObj(r) || !str(r.walkthrough)) bad(`walkthroughs.runs[${i}] is not a run (an object with a walkthrough id)`)
  })
  f.orderbook.forEach((r: any, i: number) => {
    if (!isObj(r) || !isStr(r.table) || !Object.hasOwn(bookSchema, r.table) || !isStr(r.key) || !isObj(r.value))
      bad(`orderbook[${i}] is not a row (table one of ${Object.keys(bookSchema).join(', ')}, a string key and an object value)`)
  })

  if (f.selection !== undefined) {
    const s = f.selection
    if (!isObj(s) || (s.chain !== undefined && !chains.has(s.chain)) || (s.account !== undefined && !(isAddr(s.account) && addrs.has(s.account.toLowerCase()))))
      bad('Invalid selection: its chain and account must be in this file')
  }
  if (!opts.crossEngineOk && f.engine !== opts.engine) bad(`Engine mismatch: file is from ${name(f.engine, 'unknown')}, this app runs ${opts.engine}`)

  if (errors.length) return { errors }
  return { ok: { ...f, chains: f.chains.map((c: any) => chains.get(c.id)) } as WorkspaceFile }
}
