import { useState } from 'react'
import type { ChainRecord } from '@evmb/workspace'
import { Modal } from '../shell/Modal'
import { S } from '../theme'
import { checkChainName } from './view'

/** The prototype's "New chain" modal. `onCreate` undefined: the workspace isn't open yet. */
export function NewChainModal(p: { chains: ChainRecord[]; onCreate?(name: string, desc: string): Promise<void>; onClose(): void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = () => {
    const bad = checkChainName(p.chains, name)
    if (bad) return setError(bad)
    setBusy(true)
    p.onCreate!(name.trim(), desc.trim()).catch((e) => { setError(e instanceof Error ? e.message : String(e)); setBusy(false) })
  }
  return (
    <Modal title="New chain" intro="It starts local, in this browser. You can deploy it later." error={error}
      confirmLabel="Create chain" canConfirm={!!p.onCreate && !busy} onConfirm={submit} onClose={p.onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={S.label}>Name
          <input type="text" autoFocus value={name} onChange={(e) => { setName(e.target.value); setError('') }} placeholder="e.g. Household ledger" style={S.input} />
        </label>
        <label style={S.label}>Description (optional)
          <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} style={S.input} />
        </label>
      </div>
    </Modal>
  )
}
