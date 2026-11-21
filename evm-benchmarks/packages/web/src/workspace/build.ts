import { bookSchema, type Store } from '@evmb/orderbook'
import type { Address } from '@evmb/core'
import type { Kv } from '../store/kv'
import type { Account } from '../store/accounts'
import type { createChainRegistry } from '../chain/registry'
import { CROSS_ENGINE_OK, encodeJson, type ChainFile } from '../chain/chainFile'
import { createSnapshotStore, type Snapshot } from '../chain/snapshots'
import { NO_SNAPSHOT } from '../chain/snapshotUi'
import { createContractsRegistry } from '../contracts/registry'
import { createWebAssets } from '../assets/registry'
import type { Run, Walkthrough } from '../walkthrough/types'
import { createSecrets } from '../htlc/secrets'
import type { WorkspaceFile } from './types'
import { validateWorkspace } from './validate'

export type WorkspaceEnv = {
  registry: ReturnType<typeof createChainRegistry>
  kv: Kv
  accounts: Account[]
  /** `persistent: false` = the order-book store fell back to memory (the app's bookStore) */
  book: Store & { persistent?: boolean }
  /** localStorage in the app: the selected chain and the active walkthrough */
  storage: Pick<Storage, 'getItem'>
  engine: string
  /** the acting account (app state, not stored) */
  account?: Address
}

// Keys owned by state.tsx (selected chain), walkthrough/runs.ts (active, runs) and pages/GetStarted.tsx (edits).
export const SELECTED_CHAIN = 'evmb.selectedChain'
export const ACTIVE_WALKTHROUGH = 'evmb.walkthrough.active'
export const EDITS = 'walkthroughEdits'
export const RUNS = 'walkthroughRuns'

const get = (s: WorkspaceEnv['storage'], k: string) => { try { return s.getItem(k) ?? undefined } catch { return undefined } }

/** The whole workspace as plain data. Saved chains only (benchmark chains are skipped), one at a time via registry.withChain so more than LIVE_MAX work (and Save works at the cap). */
export async function buildWorkspace(env: WorkspaceEnv): Promise<WorkspaceFile> {
  const { registry, kv } = env
  const contracts = createContractsRegistry(kv), assets = createWebAssets(kv)
  const saved = (await registry.list()).filter(c => !c.ephemeral)
  const chains: WorkspaceFile['chains'] = []
  for (const info of saved) {
    const file = await registry.withChain(info.id, async (h): Promise<ChainFile> => {
      if (!h.approach.snapshot) throw new Error(NO_SNAPSHOT)
      return {
        format: 'evm.fun/chain', version: 1, exportedAt: new Date().toISOString(), chainId: 31337, engine: env.engine,
        chain: { name: info.name, type: info.type }, dump: await h.approach.snapshot(),
        contracts: await contracts.list(info.id), assets: (await assets.list(info.id)).filter(a => a.kind === 'erc20'),
        ...(info.source && { source: info.source }),
      }
    })
    chains.push({ ...file, id: info.id })
  }
  const ids = new Set(saved.map(c => c.id))
  const snaps = createSnapshotStore(kv), snapshots: Snapshot[] = []
  for (const c of saved) snapshots.push(...(await snaps.list(c.id)).map(s => ({ ...s, assets: s.assets ?? [] }))) // taken before assets were kept
  const orderbook: WorkspaceFile['orderbook'] = []
  for (const table of Object.keys(bookSchema)) for (const r of await env.book.entries(table)) orderbook.push({ table, ...r })
  const stored = get(env.storage, SELECTED_CHAIN), active = get(env.storage, ACTIVE_WALKTHROUGH)
  const chain = stored && ids.has(stored) ? stored : undefined
  const account = env.accounts.find(a => a.address.toLowerCase() === env.account?.toLowerCase())?.address
  const selection = chain || account ? { ...(chain && { chain }), ...(account && { account }) } : undefined
  return {
    format: 'evm.fun/workspace', version: 1, savedAt: new Date().toISOString(), engine: env.engine,
    accounts: env.accounts.map(({ label, address, privateKey }) => ({ label, address, privateKey })),
    chains,
    ...(selection && { selection }),
    snapshots,
    walkthroughs: { edits: await kv.list<Walkthrough>(EDITS), runs: await kv.list<Run>(RUNS) },
    ...(active && { activeWalkthrough: active }),
    orderbook,
    secrets: await createSecrets(kv).all(),
  }
}

/** JSON with chain-file bigint encoding (`{ $bigint }`). */
export const encodeWorkspace = (f: WorkspaceFile): string => encodeJson(f)

/** `workspace-YYYY-MM-DD.json` (local date). */
export const workspaceFileName = (d = new Date()) =>
  `workspace-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`

/** The Save file. Any failure while building (e.g. a chain that won't open), or a file Open would refuse (legacy
 *  rows), reads as a Save error. */
export async function saveWorkspace(env: WorkspaceEnv): Promise<{ name: string; text: string }> {
  try {
    const text = encodeWorkspace(await buildWorkspace(env))
    const v = validateWorkspace(text, { engine: env.engine, crossEngineOk: CROSS_ENGINE_OK })
    if ('errors' in v) throw new Error(`the file wouldn't open: ${v.errors.join('; ')}`)
    return { name: workspaceFileName(), text }
  } catch (e) {
    throw new Error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`)
  }
}
