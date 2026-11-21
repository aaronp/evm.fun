import { privateKeyToAccount } from 'viem/accounts'
import { bookSchema, priceKey } from '@evmb/orderbook'
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
    const e = runError(r)
    if (e) bad(`walkthroughs.runs[${i}]: ${e}`)
  })
  f.orderbook.forEach((r: any, i: number) => {
    const e = rowError(r)
    if (e) bad(`orderbook[${i}]: ${e}`)
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

/** What the wizard and ribbon dereference: run.values[k], run.steps[id].outputs/inputs. */
function runError(r: any): string | null {
  if (!isObj(r) || !str(r.walkthrough)) return 'not a run (an object with a walkthrough id)'
  if (!isStr(r.started) || typeof r.edited !== 'boolean') return 'needs started (string) and edited (boolean)'
  if (!isObj(r.values) || !Object.values(r.values).every(isObj)) return 'values must be an object of objects'
  if (!isObj(r.steps) || !Object.values(r.steps).every(s => isObj(s) && isObj(s.inputs) && isStr(s.at)))
    return 'steps must be an object of step records (inputs, outputs, at)'
  return null
}

const isBig = (v: unknown) => typeof v === 'bigint'
const isUint = (v: unknown) => Number.isInteger(v) && (v as number) >= 0
const isHex = (v: unknown) => isStr(v) && /^0x[0-9a-fA-F]*$/.test(v)
const STATUSES = ['pending', 'success', 'reverted', 'error']

/** Per table, the fields the store's indexes and the venues read (bigints where they do arithmetic). */
function rowError(r: any): string | null {
  if (!isObj(r) || !isStr(r.key) || !isStr(r.table) || !Object.hasOwn(bookSchema, r.table))
    return `not a row (table one of ${Object.keys(bookSchema).join(', ')} and a string key)`
  const v = r.value
  if (r.table === 'meta') return isUint(v) ? null : 'a meta value must be a non-negative integer'
  if (!isObj(v) || !str(v.scope) || !isAddr(v.venue) || !isAddr(v.owner) || !isUint(v.seq) || !isStr(v.time))
    return `${r.table} rows need scope, venue, owner, seq and time`
  if (r.table === 'attempts') {
    if (!STATUSES.includes(v.status)) return `status must be one of ${STATUSES.join(', ')}`
    if ((v.tx !== undefined && !hex(64)(v.tx)) || (v.block !== undefined && !isBig(v.block)) || (v.error !== undefined && !isStr(v.error)))
      return 'invalid tx, block or error'
    return null
  }
  // orders
  if (!hex(64)(v.id) || !isAddr(v.base) || !isAddr(v.quote) || (v.side !== 'buy' && v.side !== 'sell') || !isHex(v.sig))
    return 'orders need id, base, quote, side (buy|sell) and sig'
  if (!isBig(v.price) || !isBig(v.amount)) return 'price and amount must be bigints'
  let pk: string | undefined
  try { pk = priceKey(v.side, v.price) } catch { /* out of range */ }
  if (v.priceKey !== pk) return 'priceKey does not match side and price'
  const o = v.order
  if (!isObj(o) || !isAddr(o.maker) || !isAddr(o.base) || !isAddr(o.quote) || (o.side !== 0 && o.side !== 1)
    || !['price', 'amount', 'nonce', 'expiry'].every(k => isBig(o[k]))) return 'order must be a signed order (bigint price, amount, nonce, expiry)'
  if (v.closed !== undefined && !(isObj(v.closed) && isBig(v.closed.filled) && typeof v.closed.cancelled === 'boolean'))
    return 'closed must be { filled: bigint, cancelled: boolean }'
  return null
}
