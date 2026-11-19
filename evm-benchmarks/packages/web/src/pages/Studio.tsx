import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { basicSetup, EditorView } from 'codemirror'
import { EditorSelection } from '@codemirror/state'
import { solidity } from '@replit/codemirror-lang-solidity'
import { encodeDeployData } from 'viem'
import { accounts } from '../store/accounts'
import { useApp } from '../state'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { compileInWorker } from '../solc/client'
import { templates } from '../solc/templates'
import type { CompileResult } from '../solc/compile'
import { parseArg } from '../abi/args'
import { signAndSend } from '../tx/send'
import { contractsRegistry, type DeployedContract } from '../contracts/registry'

const input = 'rounded-md border border-slate-300 px-2 py-1 text-sm'

function Editor({ value, onChange, viewRef }: { value: string; onChange(v: string): void; viewRef: React.MutableRefObject<EditorView | undefined> }) {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef(onChange)
  cb.current = onChange
  useEffect(() => {
    const view = new EditorView({
      doc: value,
      parent: host.current!,
      extensions: [basicSetup, solidity, EditorView.updateListener.of(u => u.docChanged && cb.current(u.state.doc.toString()))],
    })
    viewRef.current = view
    return () => view.destroy()
  }, [])
  // template switch replaces the document
  useEffect(() => {
    const v = viewRef.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])
  return <div ref={host} className="h-96 overflow-auto rounded-md border border-slate-300 bg-white text-sm" />
}

export function Studio() {
  const { chain, account } = useApp()
  const [source, setSource] = useState(templates[0]!.source)
  const view = useRef<EditorView>()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CompileResult>()
  const [pick, setPick] = useState(0)
  const [args, setArgs] = useState<string[]>([])
  const [deployer, setDeployer] = useState(account ?? '')
  const [status, setStatus] = useState<{ ok: boolean; text: string }>()
  const [deployed, setDeployed] = useState<DeployedContract[]>([])
  const list = accounts.list()
  const contract = result?.contracts[pick]
  const ctor = contract?.abi.find(x => x.type === 'constructor')?.inputs ?? []

  useEffect(() => {
    if (chain) contractsRegistry.list(chain.info.id).then(setDeployed)
    else setDeployed([])
  }, [chain])
  useEffect(() => setDeployer(d => d || account || ''), [account])

  const compile = async () => {
    setBusy(true)
    setStatus(undefined)
    const r = await compileInWorker(source)
    setBusy(false)
    setResult(r)
    setPick(0)
    setArgs([])
  }
  const jump = (line: number) => {
    const v = view.current
    if (!v || line > v.state.doc.lines) return
    const l = v.state.doc.line(line)
    v.dispatch({ selection: EditorSelection.cursor(l.from), effects: EditorView.scrollIntoView(l.from, { y: 'center' }) })
    v.focus()
  }

  const deploy = async () => {
    const from = list.find(a => a.address === deployer)
    if (!chain || !contract || !from) return
    setStatus(undefined)
    try {
      const parsed = ctor.map((p: { type: string }, i: number) => parseArg(p.type, args[i] ?? ''))
      const data = encodeDeployData({ abi: contract.abi, bytecode: contract.bytecode, args: parsed })
      const r = await signAndSend(chain, from, { data })
      if (r.status !== 'success' || !r.contractAddress) throw new Error(`Deploy ${r.status}${r.error ? `: ${r.error}` : ''}`)
      await contractsRegistry.add(chain.info.id, { address: r.contractAddress, name: contract.name, abi: contract.abi, deployer: from.address, txHash: r.hash })
      setDeployed(await contractsRegistry.list(chain.info.id))
      setStatus({ ok: true, text: `Deployed ${contract.name} at ${r.contractAddress}` })
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Studio</h1>
      <div className="flex items-center gap-2">
        <select
          aria-label="Template"
          className={input}
          defaultValue=""
          onChange={e => e.target.value && setSource(templates.find(t => t.name === e.target.value)!.source)}
        >
          <option value="">Load template…</option>
          {templates.map(t => <option key={t.name}>{t.name}</option>)}
        </select>
        <Button onClick={compile} disabled={busy}>
          {busy && <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />}
          {busy ? 'Compiling…' : 'Compile'}
        </Button>
        {busy && <span className="text-xs text-slate-500">The first compile loads the compiler (~10 MB).</span>}
      </div>
      <Editor value={source} onChange={setSource} viewRef={view} />

      {result && result.errors.length > 0 && (
        <Card className="space-y-1 text-sm">
          {result.errors.map((e, i) => (
            <div key={i} className={e.severity === 'error' ? 'text-red-700' : 'text-amber-700'}>
              <span className="font-medium">{e.severity}</span>
              {e.line !== undefined && (
                <button className="mx-1 underline" onClick={() => jump(e.line!)}>line {e.line}</button>
              )}
              <span>{e.message}</span>
            </div>
          ))}
        </Card>
      )}

      {contract && (
        <Card className="space-y-3">
          {result!.contracts.length > 1 && (
            <select aria-label="Contract" className={input} value={pick} onChange={e => { setPick(+e.target.value); setArgs([]) }}>
              {result!.contracts.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
            </select>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium">ABI ({contract.abi.length} entries)</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-100 p-2 text-xs">{JSON.stringify(contract.abi, null, 2)}</pre>
          </details>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Deploy {contract.name}</h2>
            <select aria-label="Deployer" className={input} value={deployer} onChange={e => setDeployer(e.target.value)}>
              <option value="">Deployer account…</option>
              {list.map(a => <option key={a.address} value={a.address}>{a.label} ({a.address.slice(0, 8)}…)</option>)}
            </select>
            {ctor.map((p: { name: string; type: string }, i: number) => (
              <label key={i} className="block text-sm">
                {p.name || `arg${i}`} <span className="text-slate-500">({p.type})</span>
                <input className={`${input} ml-2 w-80`} value={args[i] ?? ''} onChange={e => setArgs(a => Object.assign([...a], { [i]: e.target.value }))} />
              </label>
            ))}
            <div>
              <Button onClick={deploy} disabled={!chain || !deployer}>Deploy</Button>
              {!chain && <span className="ml-2 text-xs text-slate-500">Select a chain first.</span>}
              {chain && list.length === 0 && <span className="ml-2 text-xs text-slate-500">Create an account first.</span>}
            </div>
            {status && <div role="status" className={`text-sm ${status.ok ? 'text-green-700' : 'text-red-700'}`}>{status.text}</div>}
          </div>
        </Card>
      )}

      {deployed.length > 0 && (
        <Card className="space-y-1 text-sm">
          <h2 className="font-semibold">Deployed on this chain</h2>
          {deployed.map(c => (
            <div key={c.address} className="flex gap-2">
              <span>{c.name}</span>
              <span className="font-mono text-xs">{c.address}</span>
              <Link className="underline" to={`/transact?contract=${c.address}`}>Open in Transact</Link>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
