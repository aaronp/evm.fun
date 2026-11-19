import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { basicSetup, EditorView } from 'codemirror'
import { EditorSelection } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { solidity } from '@replit/codemirror-lang-solidity'
import { encodeDeployData } from 'viem'
import { accounts } from '../store/accounts'
import { useApp } from '../state'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Input, Select } from '../ui/input'
import { compileInWorker } from '../solc/client'
import { templates } from '../solc/templates'
import type { CompileResult } from '../solc/compile'
import { encodeArgs } from '../abi/args'
import { signAndSend } from '../tx/send'
import { ADDRESS_LIST } from '../components/AddressList'
import { contractsRegistry, type DeployedContract } from '../contracts/registry'

// Only var(--c-…) strings: a theme switch recolours the editor live, no remount.
const editorTheme = EditorView.theme({
  '&': { color: 'var(--c-text)', backgroundColor: 'var(--c-panel)', height: '100%' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: '13px' },
  '.cm-content': { caretColor: 'var(--c-accent)' },
  '.cm-cursor': { borderLeftColor: 'var(--c-accent)' },
  '&.cm-focused': { outline: '2px solid var(--c-accent)', outlineOffset: '-2px' },
  '.cm-gutters': { backgroundColor: 'var(--c-panel)', color: 'var(--c-faint)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--c-surface-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--c-surface-hover)', color: 'var(--c-text-2)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--c-selected)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--c-accent-soft)', outline: '1px solid var(--c-accent)' },
  // Popups: CodeMirror's base theme hard-codes light colours behind '&light ...' selectors; '&.cm-editor' and doubled classes out-rank them.
  '&.cm-editor .cm-tooltip.cm-tooltip': { backgroundColor: 'var(--c-surface)', color: 'var(--c-text)', border: '1px solid var(--c-line-strong)' },
  '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--c-accent-soft)', color: 'var(--c-text)' },
  '&.cm-editor .cm-panels.cm-panels': { backgroundColor: 'var(--c-surface)', color: 'var(--c-text)', borderColor: 'var(--c-line-strong)' },
  '&.cm-editor .cm-panels-top.cm-panels': { borderBottom: '1px solid var(--c-line-strong)' },
  '&.cm-editor .cm-panels-bottom.cm-panels': { borderTop: '1px solid var(--c-line-strong)' },
  '&.cm-editor .cm-panel.cm-search label': { color: 'var(--c-text-2)' },
  '&.cm-editor .cm-panel.cm-search input, &.cm-editor .cm-panel.cm-search button, &.cm-editor .cm-textfield.cm-textfield, &.cm-editor .cm-button.cm-button': {
    backgroundColor: 'var(--c-panel)', backgroundImage: 'none', color: 'var(--c-text)', border: '1px solid var(--c-line-strong)',
  },
  '&.cm-editor .cm-searchMatch.cm-searchMatch': { backgroundColor: 'var(--c-accent-soft)', outline: '1px solid var(--c-line-strong)' },
  '&.cm-editor .cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--c-accent-soft)', outline: '2px solid var(--c-accent)' },
  '&.cm-editor .cm-foldPlaceholder.cm-foldPlaceholder': { backgroundColor: 'var(--c-surface)', border: '1px solid var(--c-line-strong)', color: 'var(--c-muted)' },
})
const highlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.definitionKeyword], color: 'var(--c-code-keyword)' },
    { tag: [t.string, t.regexp], color: 'var(--c-code-string)' },
    { tag: [t.number, t.bool, t.null], color: 'var(--c-warn-text)' },
    { tag: [t.typeName, t.className], color: 'var(--c-accent)' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--c-success-text)' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--c-muted)', fontStyle: 'italic' },
    { tag: [t.operator, t.punctuation], color: 'var(--c-text-2)' },
  ]),
)

function Editor({ value, onChange, viewRef }: { value: string; onChange(v: string): void; viewRef: React.MutableRefObject<EditorView | undefined> }) {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef(onChange)
  cb.current = onChange
  useEffect(() => {
    const view = new EditorView({
      doc: value,
      parent: host.current!,
      extensions: [basicSetup, solidity, editorTheme, highlight, EditorView.updateListener.of(u => u.docChanged && cb.current(u.state.doc.toString()))],
    })
    viewRef.current = view
    return () => view.destroy()
  }, [])
  // template switch replaces the document
  useEffect(() => {
    const v = viewRef.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])
  return <div ref={host} className="h-96 overflow-auto border-t border-line-strong" />
}

export function Studio() {
  const { chain, account, bumpBalance } = useApp()
  const [source, setSource] = useState(templates[0]!.source)
  const [fileName, setFileName] = useState(templates[0]!.name) // unit name feeds the metadata hash
  const view = useRef<EditorView>()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CompileResult>()
  const [pick, setPick] = useState(0)
  const [args, setArgs] = useState<string[]>([])
  const [deployer, setDeployer] = useState(account ?? '')
  const [deploying, setDeploying] = useState(false)
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
    let r: CompileResult
    try {
      r = await compileInWorker(source, fileName)
    } catch (e) {
      r = { contracts: [], errors: [{ severity: 'error', message: `Compiler failed: ${e instanceof Error ? e.message : String(e)}` }] }
    } finally {
      setBusy(false)
    }
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
    if (!chain || !contract || !from || deploying) return
    setStatus(undefined)
    const parsed = encodeArgs(ctor, args)
    if (!parsed.ok) return setStatus({ ok: false, text: parsed.errors.join('; ') })
    setDeploying(true)
    try {
      const data = encodeDeployData({ abi: contract.abi, bytecode: contract.bytecode, args: parsed.values })
      const r = await signAndSend(chain, from, { data }, bumpBalance)
      if (r.status !== 'success' || !r.contractAddress) throw new Error(`Deploy ${r.status}${r.error ? `: ${r.error}` : ''}`)
      await contractsRegistry.add(chain.info.id, { address: r.contractAddress, name: contract.name, abi: contract.abi, deployer: from.address, txHash: r.hash })
      setDeployed(await contractsRegistry.list(chain.info.id))
      setStatus({ ok: true, text: `Deployed ${contract.name} at ${r.contractAddress}` })
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setDeploying(false)
    }
  }

  const errorCount = result?.errors.filter(e => e.severity === 'error').length ?? 0
  const status_ = !result ? <Badge>Not compiled</Badge> : errorCount > 0 ? <Badge variant="danger">{errorCount} error{errorCount > 1 ? 's' : ''}</Badge> : <Badge variant="success">Compiled</Badge>

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-semibold">Studio</h1>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-xl border border-line-strong bg-panel">
            <div className="flex flex-wrap items-center gap-2 p-3">
              <span className="mr-auto font-mono text-sm text-text-2">{fileName}</span>
              {status_}
              <Select
                aria-label="Template"
                defaultValue=""
                onChange={e => {
                  const t = templates.find(t => t.name === e.target.value)
                  if (t) { setSource(t.source); setFileName(t.name); setResult(undefined); setStatus(undefined) }
                }}
              >
                <option value="">Load template…</option>
                {templates.map(t => <option key={t.name}>{t.name}</option>)}
              </Select>
              <Button onClick={compile} disabled={busy}>
                {busy && <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-on-accent border-t-transparent" aria-hidden />}
                {busy ? 'Compiling…' : 'Compile'}
              </Button>
            </div>
            {busy && <p className="px-3 pb-3 text-xs text-muted">The first compile loads the compiler (~10 MB).</p>}
            <Editor value={source} onChange={setSource} viewRef={view} />
          </div>

          {result && result.errors.length > 0 && (
            <Card className="space-y-2 text-sm">
              {result.errors.map((e, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Badge variant={e.severity === 'error' ? 'danger' : 'warn'}>{e.severity}</Badge>
                  {e.line !== undefined && (
                    <button className="text-accent underline hover:text-accent-hover" onClick={() => jump(e.line!)}>line {e.line}</button>
                  )}
                  <span className="min-w-0 break-words">{e.message}</span>
                </div>
              ))}
            </Card>
          )}

          {result && result.errors.every(e => e.severity !== 'error') && result.contracts.length === 0 && (
            <Card className="text-sm">No deployable contract in this file</Card>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {contract && (
            <Card className="space-y-3">
              {result!.contracts.length > 1 && (
                <Select aria-label="Contract" className="w-full" value={pick} onChange={e => { setPick(+e.target.value); setArgs([]) }}>
                  {result!.contracts.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
                </Select>
              )}
              <details>
                <summary className="cursor-pointer text-sm font-medium">ABI ({contract.abi.length} entries)</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-panel p-2 font-mono text-xs">{JSON.stringify(contract.abi, null, 2)}</pre>
              </details>
              <div className="space-y-3">
                <h2 className="font-display text-sm font-semibold">Deploy {contract.name}</h2>
                <Select aria-label="Deployer" className="w-full" value={deployer} onChange={e => setDeployer(e.target.value)}>
                  <option value="">Deployer account…</option>
                  {list.map(a => <option key={a.address} value={a.address}>{a.label} ({a.address.slice(0, 8)}…)</option>)}
                </Select>
                {ctor.map((p: { name: string; type: string }, i: number) => (
                  <label key={i} className="block space-y-1 text-sm">
                    <span>{p.name || `arg${i}`} <span className="font-mono text-xs text-muted">({p.type})</span></span>
                    <Input className="w-full" list={p.type === 'address' ? ADDRESS_LIST : undefined} value={args[i] ?? ''} onChange={e => setArgs(a => Object.assign([...a], { [i]: e.target.value }))} />
                  </label>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <Button className="w-full" onClick={deploy} disabled={!chain || !deployer || deploying}>{deploying ? 'Deploying…' : 'Deploy'}</Button>
                  {!chain && <span className="text-xs text-muted">Select a chain first.</span>}
                  {chain && list.length === 0 && <span className="text-xs text-muted">Create an account first.</span>}
                </div>
                {status && <div role="status" className={`break-words text-sm ${status.ok ? 'text-success-text' : 'text-danger'}`}>{status.text}</div>}
              </div>
            </Card>
          )}

          {deployed.length > 0 && (
            <Card className="space-y-2 text-sm">
              <h2 className="font-display font-semibold">Deployed on this chain</h2>
              {deployed.map(c => (
                <div key={c.address} className="space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.name}</span>
                    <Link className="text-accent underline hover:text-accent-hover" to={`/transact?contract=${c.address}`}>Open in Transact</Link>
                  </div>
                  <div className="break-all font-mono text-xs text-muted">{c.address}</div>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
