import type { DeployedContract as ContractRecord } from '../contracts/registry'
import type { ChainType } from './handle'

export type ChainSource =
  | { kind: 'snapshot'; snapshotName: string; fromChainName: string; height: number }
  | { kind: 'import'; fileName: string; height: number }

export interface ChainFile {
  format: 'evm.fun/chain'; version: 1; exportedAt: string; chainId: number; engine: string
  chain: { name: string; type: ChainType }; dump: unknown; contracts: ContractRecord[]; source?: ChainSource
}

// ADR "Chain snapshots via webevm dumpState/loadState": dumps load across engines (both ways).
export const CROSS_ENGINE_OK = true

// Keys of a webevm 0.9.1 dump (see the ADR); a wrong-shape dump is rejected before anything is created.
const DUMP_KEYS = ['version', 'chainId', 'accounts', 'code', 'storage', 'blocks', 'receipts', 'transactions']

export const encodeChainFile = (f: ChainFile): string =>
  JSON.stringify(f, (_k, v) => (typeof v === 'bigint' ? { $bigint: v.toString() } : v))

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown) => typeof v === 'string'
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const MAX = 200
// Untrusted values must never be interpolated directly (a toString that isn't a function throws).
const show = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? String(v)
  : typeof v === 'string' ? JSON.stringify(v.slice(0, 40)) : Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v
const str = (v: unknown) => isStr(v) && (v as string).length <= MAX
const hex = (n: number) => (v: unknown) => isStr(v) && new RegExp(`^0x[0-9a-fA-F]{${n}}$`).test(v as string)
const isAddr = hex(40), isHash = hex(64)

function contractError(c: any, i: number): string | null {
  const at = `contracts[${i}]`
  if (!isObj(c)) return `${at} is not an object`
  if (!isAddr(c.address)) return `${at}.address is not an address`
  if (!isAddr(c.deployer)) return `${at}.deployer is not an address`
  if (!isHash(c.txHash)) return `${at}.txHash is not a transaction hash`
  if (!str(c.name)) return `${at}.name is not a string of at most ${MAX} characters`
  if (!Array.isArray(c.abi) || !c.abi.every(isObj)) return `${at}.abi is not an array of objects`
  return null
}

type Decoded = { ok: true; file: ChainFile } | { ok: false; error: string }
export function decodeChainFile(text: string, opts: { engine: string; crossEngineOk: boolean }): Decoded {
  try { return decode(text, opts) } catch { return { ok: false, error: 'Invalid file' } }
}

function decode(text: string, opts: { engine: string; crossEngineOk: boolean }): Decoded {
  const bad = (error: string) => ({ ok: false as const, error })
  let badBigint = false
  const reviver = (_k: string, v: any) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== 1 || !('$bigint' in v)) return v
    if (isStr(v.$bigint) && /^-?\d+$/.test(v.$bigint)) return BigInt(v.$bigint)
    badBigint = true
    return v
  }
  let f: any
  try { f = JSON.parse(text, reviver) } catch { return bad('Not valid JSON (the file may be truncated)') }
  if (badBigint) return bad('Invalid $bigint value')
  if (!isObj(f)) return bad('Not a chain file: expected a JSON object')
  if (f.format !== 'evm.fun/chain') return bad(`Wrong format: expected "evm.fun/chain"`)
  if (typeof f.version === 'number' && f.version > 1) return bad(`Unsupported version ${show(f.version)}: made by a newer version of evm.fun`)
  if (f.version !== 1) return bad('Missing or invalid version: expected 1')
  if (f.chainId !== 31337) return bad(`Unsupported chainId ${show(f.chainId)}: only 31337 can be imported`)
  if (!isStr(f.exportedAt)) return bad('Missing or invalid exportedAt')
  if (!isStr(f.engine)) return bad('Missing or invalid engine')
  if (!isObj(f.chain) || !str(f.chain.name) || (f.chain.type !== 'plain' && f.chain.type !== 'sequencer'))
    return bad(`Missing or invalid chain (needs name up to ${MAX} characters and type plain|sequencer)`)
  if (!Array.isArray(f.contracts)) return bad('Missing or invalid contracts')
  for (let i = 0; i < f.contracts.length; i++) {
    const e = contractError(f.contracts[i], i)
    if (e) return bad(e)
  }
  const d = f.dump
  if (!isObj(d)) return bad('Missing or invalid dump: expected an object')
  const missing = DUMP_KEYS.filter(k => !(k in d))
  if (missing.length) return bad(`Invalid dump: missing ${missing.join(', ')}`)
  for (const k of ['accounts', 'code', 'storage']) if (!isObj(d[k])) return bad(`Invalid dump: ${k} is not an object`)
  for (const k of ['blocks', 'receipts', 'transactions']) if (!Array.isArray(d[k])) return bad(`Invalid dump: ${k} is not an array`)
  if (d.chainId !== 31337) return bad(`Invalid dump: chainId ${show(d.chainId)} is not 31337`)
  if (f.source !== undefined) {
    const s = f.source
    const ok = isObj(s) && Number.isInteger(s.height) && s.height >= 0 && (s.kind === 'import' ? str(s.fileName)
      : s.kind === 'snapshot' && str(s.snapshotName) && str(s.fromChainName))
    if (!ok) return bad('Invalid source')
  }
  if (!opts.crossEngineOk && f.engine !== opts.engine)
    return bad(`Engine mismatch: file is from ${show(f.engine)}, this app runs ${opts.engine}`)
  return { ok: true, file: f as ChainFile }
}

export const fileNameFor = (chainName: string, height: number): string => {
  const tail = `-${height}.evmfun.json`
  const slug = chainName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 119 - tail.length).replace(/-$/, '')
  return (slug || 'chain') + tail
}

export const defaultSnapshotName = (chainName: string, height: number): string => `${chainName} @ block ${height}`

export const provenanceText = (src?: ChainSource): string | null =>
  !src ? null
    : src.kind === 'snapshot' ? `from snapshot '${src.snapshotName}' of ${src.fromChainName} @ #${src.height}`
    : `imported from ${src.fileName} @ #${src.height}`
