import { useState, type RefObject } from 'react'
import { privateKeyToAccount } from 'viem/accounts'
import { NodeError, type CreateChainResult } from '@evmb/node/src/client'
import { registry } from '../../chain/revm'
import type { ChainHandle } from '../../chain/handle'
import { deployChain, type DeployStep } from '../../cloud/deploy'
import { clientFor, nodeUrl } from '../../cloud/node'
import { useApp } from '../../state'
import { accounts } from '../../store/accounts'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { Notice } from '../../ui/notice'
import { CheckIcon, AlertIcon } from '../../ui/icons'

export const STEPS: { step: DeployStep; label: string }[] = [
  { step: 'prepare', label: 'Preparing your chain…' },
  { step: 'code', label: 'Checking your code…' },
  { step: 'node', label: 'Starting your node…' },
  { step: 'replace', label: 'Matching your browser…' },
]
const message = (e: unknown) => (e instanceof NodeError ? e.error : e instanceof Error ? e.message : String(e))

/** Native modal (parent calls showModal). Errors keep it open so another code can be tried, unless the cloud chain already exists. */
export function DeployDialog({ dialogRef, chain, onDeployed }: { dialogRef: RefObject<HTMLDialogElement | null>; chain: ChainHandle; /** e.g. reload the block list */ onDeployed?: () => void }) {
  const { account, refresh, bumpBalance, setBusy, selectChain } = useApp()
  const acct = accounts.list().find((a) => a.address === account)
  const [code, setCode] = useState('')
  const [running, setRunning] = useState(false)
  const [seen, setSeen] = useState<Partial<Record<DeployStep, string>>>({})
  const [err, setErr] = useState<{ text: string; step?: DeployStep; chainId?: string; url?: string }>()
  const [result, setResult] = useState<CreateChainResult>()
  const reset = () => { setCode(''); setSeen({}); setErr(undefined); setResult(undefined) }
  // the cloud chain exists: another try would create a second one, so only Close is offered
  const exists = err?.step === 'replace' && !!err.chainId
  const last = STEPS.filter((s) => seen[s.step] !== undefined).at(-1)?.step

  async function deploy() {
    if (!acct) return
    setRunning(true); setBusy(true)
    setSeen({}); setErr(undefined); setResult(undefined)
    try {
      const r = await deployChain({
        chain, account: privateKeyToAccount(acct.privateKey), code, client: clientFor(acct), registry,
        onStep: (s, d) => setSeen((x) => ({ ...x, [s]: d })),
      })
      setResult(r)
      await refresh()
      await selectChain(chain.info.id) // the same chain, now a follower
      bumpBalance()
      onDeployed?.()
    } catch (e) {
      const { step, chainId, url } = e as { step?: DeployStep; chainId?: string; url?: string }
      setErr({ text: message(e), step, chainId, url })
      if (step === 'node') setCode('') // the code may have been spent
    } finally {
      setRunning(false); setBusy(false)
    }
  }

  return (
    <dialog ref={dialogRef} onClose={reset} onCancel={(e) => running && e.preventDefault()} aria-labelledby="deploy-title" className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-5 text-text backdrop:bg-bg/70">
      <form method="dialog" className="space-y-3" onSubmit={(e) => { e.preventDefault(); deploy() }}>
        <h2 id="deploy-title" className="font-display text-base font-semibold">Deploy “{chain.info.name}”</h2>
        <p className="text-sm text-text-2">
          A copy of this chain runs on <span className="break-all font-mono text-xs">{nodeUrl()}</span>, with you as its admin. Your browser's copy then follows it.
        </p>
        {!acct && <Notice>Select an account first: it signs the deploy and becomes the chain's admin.</Notice>}
        {!result && !exists && (
          <div className="flex gap-2">
            <Input aria-label="Deploy code" autoComplete="off" className="min-w-0 flex-1 font-mono" placeholder="Deploy code, e.g. apple-river-stone-moon" value={code} onChange={(e) => setCode(e.target.value)} disabled={running} />
            <Button type="submit" disabled={running || !acct || !code.trim()}>{running ? 'Deploying…' : err && err.step !== 'node' ? 'Try again' : 'Deploy'}</Button>
          </div>
        )}
        {last && (
          <ol className="space-y-2 text-sm">
            {STEPS.filter((s) => seen[s.step] !== undefined && !(err?.step === 'code' && s.step === 'node')).map((s) => {
              const failed = !!err && s.step === (err.step ?? last)
              const doing = running && s.step === last
              return (
                <li key={s.step} className="flex gap-2">
                  <span className={`mt-0.5 shrink-0 ${failed ? 'text-danger' : doing ? 'text-muted' : 'text-success-text'}`}>{failed ? <AlertIcon /> : doing ? '…' : <CheckIcon />}</span>
                  <div className="min-w-0">
                    <div>{failed ? `${s.label.replace('…', '')} — failed` : s.label}</div>
                    <div className="break-all font-mono text-xs text-muted">{seen[s.step]}</div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {err && <Notice>{err.step === 'replace' ? err.text : `${err.text.replace(/\.$/, '')}. Your chain wasn't changed${err.step === 'code' ? ' — try another code' : err.step === 'node' ? '. Your code may have been used — ask for another' : ''}.`}</Notice>}
        {exists && (
          <div className="space-y-1 rounded-lg border border-line p-3 text-sm" role="status">
            <div>Cloud chain <span className="font-mono text-xs">{err.chainId}</span></div>
            {err.url && <div className="break-all">URL <span className="font-mono text-xs">{err.url}</span></div>}
          </div>
        )}
        {result && (
          <div className="space-y-1 rounded-lg border border-success bg-success-soft p-3 text-sm text-success-text" role="status">
            <div className="font-medium">Deployed.</div>
            <div>Chain <span className="font-mono text-xs">{result.chainId}</span></div>
            <div className="break-all">URL <span className="font-mono text-xs">{result.url}</span></div>
            <div className="break-all">Head #{result.head.number} <span className="font-mono text-xs">{result.head.hash}</span> matches your browser</div>
            <div>Your copy now follows the cloud chain. Older transaction history isn't kept in this browser.</div>
            <div className="break-all">Admin <span className="font-mono text-xs">{acct?.address}</span></div>
          </div>
        )}
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={() => dialogRef.current?.close()} disabled={running}>{result ? 'Done' : exists ? 'Close' : 'Cancel'}</Button>
        </div>
      </form>
    </dialog>
  )
}
