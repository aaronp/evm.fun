import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createRevmEngine } from 'webevm/revm'
import { wasmUrl } from 'revm-wasm/wasm-url'
import { scenarios, type RunResult } from '@evmb/core'
import { registry } from '../chain/revm'
import type { ChainHandle, ChainType } from '../chain/handle'
import { runInBrowser } from '../bench/run'
import { useApp } from '../state'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Notice } from '../ui/notice'

// revm only, deliberately NO persistence: re-serialising the chain on every change would distort TPS.
const benchHost = { createEngine: () => createRevmEngine({ wasm: wasmUrl }) }
const input = 'rounded-md border border-slate-300 px-2 py-1 text-sm'
const num = (v: string, d: number) => Math.max(1, Math.floor(Number(v)) || d)
const f = (x: number) => x.toFixed(1)

interface Run { result: RunResult; handle: ChainHandle; type: ChainType; name: string }

function ResultCard({ r }: { r: Run }) {
  const { result, type } = r
  const t = result.approach.tradeoffs
  return (
    <Card className="space-y-1 text-sm">
      <div className="font-semibold">{r.name}: {result.approach.title}</div>
      <div>TPS {result.tps === null ? '—' : f(result.tps)} · p50 {f(result.latencyMs.p50)} ms · p99 {f(result.latencyMs.p99)} ms · {result.verified ? 'verified' : 'NOT verified'} ({result.verifyDetail})</div>
      <div>statuses: success {result.statuses.success}, reverted {result.statuses.reverted}, rejected {result.statuses.rejected}</div>
      <div>signing {f(result.signingMs)} ms (untimed, includes browser yields) · run {f(result.durationMs)} ms · engine {result.approach.engine ?? '—'} · {type}</div>
      {result.phases && <div>phases: {Object.entries(result.phases).map(([k, v]) => `${k} ${f(v)} ms`).join(', ')}</div>}
      <div>trade-offs: evm {t.evm ? 'yes' : 'no'} · stateRoot {t.stateRoot} · log {t.log} · sigVerify {t.sigVerify} · execution {t.execution}{t.notes ? ` — ${t.notes}` : ''}</div>
    </Card>
  )
}

export function Benchmark() {
  const { refresh, selectChain } = useApp()
  const nav = useNavigate()
  const [type, setType] = useState<ChainType>('plain')
  const [scenario, setScenario] = useState<keyof typeof scenarios>('eth-transfer')
  const [n, setN] = useState('2000')
  const [senders, setSenders] = useState('100')
  const [progress, setProgress] = useState<[string, number, number]>()
  const [runs, setRuns] = useState<Run[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const last = runs.at(-1)

  async function run() {
    setBusy(true); setErr(undefined)
    try {
      const { result, handle } = await runInBrowser(
        { type, scenario, n: num(n, 2000), senders: num(senders, 100), host: benchHost },
        (p, d, t) => setProgress([p, d, t]),
      )
      const name = `bench ${scenario} ${type} #${runs.length + 1}`
      handle.info.name = name
      registry.addEphemeral(handle)
      setRuns(rs => [...rs, { result, handle, type, name }])
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false); setProgress(undefined)
    }
  }

  async function open(r: Run) {
    await refresh()
    await selectChain(r.handle.info.id)
    nav('/explorer')
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Benchmark</h1>
      {err && <Notice>{err}</Notice>}
      <Card className="flex flex-wrap items-end gap-3 text-sm">
        <label>type <select className={input} value={type} onChange={e => setType(e.target.value as ChainType)}><option>plain</option><option>sequencer</option></select></label>
        <label>scenario <select className={input} value={scenario} onChange={e => setScenario(e.target.value as keyof typeof scenarios)}>{Object.keys(scenarios).map(s => <option key={s}>{s}</option>)}</select></label>
        <label>N <input className={`${input} w-24`} value={n} onChange={e => setN(e.target.value)} /></label>
        <label>senders <input className={`${input} w-24`} value={senders} onChange={e => setSenders(e.target.value)} /></label>
        <Button disabled={busy} onClick={run}>{busy ? 'Running…' : 'Run benchmark'}</Button>
      </Card>
      {progress && (
        <div className="space-y-1 text-sm">
          <div>{progress[0]}{progress[0] === 'signing' ? ` ${progress[1]}/${progress[2]}` : ''}</div>
          <progress className="w-full" max={progress[2]} value={progress[1]} />
        </div>
      )}
      {last && <ResultCard r={last} />}
      {last && <Button variant="outline" onClick={() => open(last)}>Open in Explorer</Button>}
      {runs.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead><tr><th>run</th><th>TPS</th><th>p50</th><th>p99</th><th>verified</th><th /></tr></thead>
          <tbody>
            {runs.map(r => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.result.tps === null ? '—' : f(r.result.tps)}</td>
                <td>{f(r.result.latencyMs.p50)}</td>
                <td>{f(r.result.latencyMs.p99)}</td>
                <td>{r.result.verified ? 'yes' : 'no'}</td>
                <td><Button variant="outline" onClick={() => open(r)}>Open in Explorer</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
