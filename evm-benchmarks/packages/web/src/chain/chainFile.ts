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

const reviver = (_k: string, v: any) =>
  v && typeof v === 'object' && Object.keys(v).length === 1 && typeof v.$bigint === 'string' ? BigInt(v.$bigint) : v

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown) => typeof v === 'string'
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

export function decodeChainFile(text: string, opts: { engine: string; crossEngineOk: boolean }):
  { ok: true; file: ChainFile } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error })
  let f: any
  try { f = JSON.parse(text, reviver) } catch { return bad('Not valid JSON (the file may be truncated)') }
  if (!isObj(f)) return bad('Not a chain file: expected a JSON object')
  if (f.format !== 'evm.fun/chain') return bad(`Wrong format: expected "evm.fun/chain"`)
  if (!isNum(f.version)) return bad('Missing or invalid version')
  if (f.version > 1) return bad(`Unsupported version ${f.version}: this app reads version 1`)
  if (f.chainId !== 31337) return bad(`Unsupported chainId ${f.chainId}: only 31337 can be imported`)
  if (!isStr(f.exportedAt)) return bad('Missing or invalid exportedAt')
  if (!isStr(f.engine)) return bad('Missing or invalid engine')
  if (!isObj(f.chain) || !isStr(f.chain.name) || (f.chain.type !== 'plain' && f.chain.type !== 'sequencer'))
    return bad('Missing or invalid chain (needs name and type plain|sequencer)')
  if (!Array.isArray(f.contracts)) return bad('Missing or invalid contracts')
  if (!isObj(f.dump)) return bad('Missing or invalid dump: expected an object')
  const missing = DUMP_KEYS.filter(k => !(k in f.dump))
  if (missing.length) return bad(`Invalid dump: missing ${missing.join(', ')}`)
  if (f.source !== undefined) {
    const s = f.source
    const ok = isObj(s) && isNum(s.height) && (s.kind === 'import' ? isStr(s.fileName)
      : s.kind === 'snapshot' && isStr(s.snapshotName) && isStr(s.fromChainName))
    if (!ok) return bad('Invalid source')
  }
  if (!opts.crossEngineOk && f.engine !== opts.engine)
    return bad(`Engine mismatch: file is from ${f.engine}, this app runs ${opts.engine}`)
  return { ok: true, file: f as ChainFile }
}

export const fileNameFor = (chainName: string, height: number): string =>
  `${chainName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chain'}-${height}.evmfun.json`

export const defaultSnapshotName = (chainName: string, height: number): string => `${chainName} @ block ${height}`

export const provenanceText = (src?: ChainSource): string | null =>
  !src ? null
    : src.kind === 'snapshot' ? `from snapshot '${src.snapshotName}' of ${src.fromChainName} @ #${src.height}`
    : `imported from ${src.fileName} @ #${src.height}`
