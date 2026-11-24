import { useEffect, useState } from 'react'
import { privateKeyToAccount } from 'viem/accounts'
import { NodeClient } from '@evmb/node/src/client'
import { registry } from '../../chain/revm'
import { joinChain, joinName } from '../../cloud/join'
import { useApp } from '../../state'
import type { Account } from '../../store/accounts'
import { Button } from '../../ui/button'
import { Input, fieldLabel } from '../../ui/input'
import { Notice } from '../../ui/notice'
import { Panel } from '../../ui/panel'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Join a cloud chain with an invite code; this browser then follows it, signing as `acct`. Prefilled from a join link (never the code).
 *  `usualUrl`: the node-URL setting; a link pointing elsewhere gets a warning (it could be a lookalike worker). */
export function JoinForm({ acct, nodeUrl, usualUrl, chainId: initialChain = '', onJoined }: { acct?: Account; nodeUrl: string; usualUrl: string; chainId?: string; onJoined?(): void }) {
  const { refresh, selectChain, setBusy } = useApp()
  const [url, setUrl] = useState(nodeUrl)
  const [urlEdited, setUrlEdited] = useState(false)
  const [chainId, setChainId] = useState(initialChain)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [running, setRunning] = useState(false)
  const [flash, setFlash] = useState<{ tone: 'success' | 'warn'; text: string }>()
  const id = chainId.trim()
  useEffect(() => { if (initialChain) { setUrl(nodeUrl); setUrlEdited(false); setChainId(initialChain) } }, [nodeUrl, initialChain]) // another join link
  useEffect(() => { if (!urlEdited) setUrl(nodeUrl) }, [nodeUrl]) // eslint-disable-line react-hooks/exhaustive-deps -- the node-URL setting changed: follow it until edited here

  async function join() {
    if (!acct) return
    setRunning(true); setBusy(true); setFlash(undefined)
    try {
      const account = privateKeyToAccount(acct.privateKey)
      const h = await joinChain({ client: new NodeClient(url.trim(), account, { name: acct.label }), chainId: id, code, account, name, registry })
      setFlash({ tone: 'success', text: `Joined. "${h.info.name}" follows chain ${id} as ${acct.label}; it's read-only in this browser.` })
      setCode(''); setName('')
      await refresh()
      await selectChain(h.info.id)
      onJoined?.()
    } catch (e) {
      const joined = (e as { joined?: string }).joined // the code was spent and the chain saved: it opens from the Chains page
      setFlash({ tone: 'warn', text: joined ? message(e) : `Couldn't join: ${message(e)}` })
      if (joined) { setCode(''); await refresh().catch(() => {}) }
    } finally {
      setRunning(false); setBusy(false)
    }
  }

  return (
    <Panel title="Join a chain">
      <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); join() }}>
        <p className="text-text-2">Follow a chain someone deployed, using the invite code they gave you. Your copy is read-only and stays in sync with the cloud.</p>
        <label className={fieldLabel}>
          Worker URL
          <Input className="font-mono" value={url} onChange={(e) => { setUrl(e.target.value); setUrlEdited(true) }} disabled={running} />
        </label>
        <label className={fieldLabel}>
          Chain id
          <Input className="font-mono" autoComplete="off" value={chainId} onChange={(e) => setChainId(e.target.value)} disabled={running} />
        </label>
        <label className={fieldLabel}>
          Code
          <Input className="font-mono" autoComplete="off" placeholder="e.g. apple-river-stone-moon" value={code} onChange={(e) => setCode(e.target.value)} disabled={running} autoFocus={!!initialChain} />
        </label>
        <label className={fieldLabel}>
          Chain name
          <Input value={name} placeholder={id ? joinName(id) : 'Joined …'} onChange={(e) => setName(e.target.value)} disabled={running} />
        </label>
        {nodeUrl !== usualUrl && url.trim() === nodeUrl && <Notice>{`This link points at ${nodeUrl}, not your usual worker ${usualUrl}. Only continue if you trust it.`}</Notice>}
        {!acct && <Notice>Select an account first: it signs the join and this browser follows the chain as it.</Notice>}
        {acct && <p className="text-xs text-muted">Joins as {acct.label}; this device shows up to the chain's admin under that name.</p>}
        <div className="flex justify-end">
          <Button type="submit" disabled={running || !acct || !url.trim() || !id || !code.trim()}>{running ? 'Joining…' : 'Join'}</Button>
        </div>
        {flash && <Notice tone={flash.tone} onDismiss={() => setFlash(undefined)}>{flash.text}</Notice>}
      </form>
    </Panel>
  )
}
