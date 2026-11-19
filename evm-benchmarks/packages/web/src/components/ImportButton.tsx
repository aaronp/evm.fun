import type { RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { ENGINE, registry } from '../chain/revm'
import { CROSS_ENGINE_OK, decodeChainFile } from '../chain/chainFile'
import { importSource } from '../chain/snapshotUi'
import { accounts } from '../store/accounts'
import { useApp } from '../state'
import type { Flash } from './SnapshotsDialog'

/** Hidden file input; the app bar's Import action calls `inputRef.current.click()`. Validates fully before creating anything. */
export function ImportButton({ inputRef, onFlash, onImported }: {
  inputRef: RefObject<HTMLInputElement | null>; onFlash: (f: Flash) => void; onImported: (chainId: string, funded: boolean) => void
}) {
  const { refresh, selectChain } = useApp()
  const nav = useNavigate()

  async function load(file: File) {
    try {
      const r = decodeChainFile(await file.text(), { engine: ENGINE, crossEngineOk: CROSS_ENGINE_OK })
      if (!r.ok) return onFlash({ tone: 'warn', text: `Import failed: ${r.error}` })
      const f = r.file
      const h = await registry.createFrom(f.dump, { name: f.chain.name, type: f.chain.type, contracts: f.contracts, assets: f.assets, source: importSource(file.name, f.dump) })
      await refresh()
      await selectChain(h.info.id)
      nav('/chains')
      // The chain exists now: a failed funds check must not read as a failed import, so treat it as unfunded.
      const funded = await Promise.all(accounts.list().map(a => h.request('eth_getBalance', [a.address, 'latest']))).then(b => b.some(x => BigInt(x as string) > 0n), () => false)
      onImported(h.info.id, funded)
      onFlash({ tone: 'success', text: `Imported "${f.chain.name}" from ${file.name}.` })
    } catch (e) {
      onFlash({ tone: 'warn', text: `Import failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return (
    <input ref={inputRef} type="file" hidden accept=".json,application/json" aria-label="Import chain file"
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) load(f) }} />
  )
}
