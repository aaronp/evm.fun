import { useAppBar } from '../state/appBar'
import { useState } from 'react'
import { ChainTypeHelp, ChainTypePicker } from '../components/ChainTypeHelp'
import { useNavigate } from 'react-router-dom'
import { createRevmEngine } from 'webevm/revm'
import { wasmUrl } from 'revm-wasm/wasm-url'
import { scenarios, type RunResult } from '@evmb/core'
import { registry } from '../chain/revm'
import type { ChainHandle, ChainType } from '../chain/handle'
import { parseBenchSize, runInBrowser } from '../bench/run'
import { addRun, sessionRuns, type Run } from '../bench/session'
import { useApp } from '../state'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Badge } from '../ui/badge'
import { fieldLabel, Input, Select } from '../ui/input'
import { Notice } from '../ui/notice'
import { Panel } from '../ui/panel'
import { Table, td, th } from '../ui/table'
import { DistributionChart } from '../components/DistributionChart'
import { tradeoffChips } from '../bench/view'

// revm only, deliberately NO persistence: re-serialising the chain on every change would distort TPS.
const benchHost = { createEngine: () => createRevmEngine({ wasm: wasmUrl }) }
const f = (x: number) => x.toFixed(1)

function Tile({ label, value, unit, caption }: { label: string; value: string; unit?: string; caption?: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line-strong bg-surface px-4 py-3">
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className="font-display text-2xl font-semibold tracking-tight">{value}{unit && <span className="text-sm font-medium text-muted"> {unit}</span>}</span>
      {caption && <span className="text-xs text-muted">{caption}</span>}
    </div>
  )
}

function ResultView({ r }: { r: Run }) {
  const { result, type } = r
  const phases = result.phases && Object.entries(result.phases)
  return (
    <section aria-label="Result" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">{r.name}</h2>
          <div className="mt-1 text-sm text-muted">{result.approach.title} · {type} · {result.params.n} tx</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {result.verified
            ? <Badge variant="success">Verified · {result.verifyDetail}</Badge>
            : <Badge variant="danger">Not verified · {result.verifyDetail}</Badge>}
          <Badge>success {result.statuses.success} · reverted {result.statuses.reverted} · rejected {result.statuses.rejected}</Badge>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Throughput" value={result.tps === null ? '—' : f(result.tps)} unit="TPS" />
        <Tile label="Latency p50" value={f(result.latencyMs.p50)} unit="ms" />
        <Tile label="Latency p99" value={f(result.latencyMs.p99)} unit="ms" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Tile label="Run (timed)" value={f(result.durationMs)} unit="ms" />
        <Tile label="Signing (untimed)" value={f(result.signingMs)} unit="ms" caption="untimed · includes browser yields" />
      </div>
      {phases && phases.length > 0 && (
        <Card className="space-y-1 text-sm">
          {phases.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3"><span className="text-muted">{k}</span><span className="font-mono">{f(v)} ms</span></div>
          ))}
        </Card>
      )}
      <Card className="flex flex-wrap items-center gap-2">
        <h3 className="mr-2 text-sm font-semibold">Trade-offs this run paid for</h3>
        {tradeoffChips(result).map(c => <Badge key={c}>{c}</Badge>)}
      </Card>
    </section>
  )
}

export function Benchmark() {
  useAppBar({ title: 'Benchmark' })
  const { refresh, selectChain } = useApp()
  const nav = useNavigate()
  const [type, setType] = useState<ChainType>('plain')
  const [scenario, setScenario] = useState<keyof typeof scenarios>('eth-transfer')
  const [n, setN] = useState('2000')
  const [senders, setSenders] = useState('100')
  const [progress, setProgress] = useState<[string, number, number]>()
  const [runs, setRuns] = useState<Run[]>(sessionRuns)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>()
  const last = runs.at(-1)

  const sampled = runs.filter(r => r.result.latencySamplesMs?.length)

  const size = parseBenchSize(n, senders)

  async function run() {
    if ('error' in size) return
    setBusy(true); setErr(undefined)
    try {
      registry.assertRoom() // before booting a run's chain
      const { result, handle } = await runInBrowser(
        { type, scenario, ...size, host: benchHost },
        (p, d, t) => setProgress([p, d, t]),
      )
      try { registry.addEphemeral(handle) } catch (e) { await handle.dispose().catch(() => {}); throw e } // cap filled mid-run: free the run's chain, show the error
      addRun(result, handle, type, scenario)
      setRuns(sessionRuns())
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
    nav('/chains')
  }

  return (
    <div className="space-y-4">
      {err && <Notice>{err}</Notice>}
      <Card className="space-y-4 text-sm">
        <h2 className="font-display text-sm font-semibold">New run</h2>
        <div className="space-y-2">
          <ChainTypePicker type={type} onChange={setType} />
          <ChainTypeHelp />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className={fieldLabel}>scenario <Select value={scenario} onChange={e => setScenario(e.target.value as keyof typeof scenarios)}>{Object.keys(scenarios).map(s => <option key={s}>{s}</option>)}</Select></label>
          <label className={fieldLabel}>N <Input className="w-28 font-mono" value={n} onChange={e => setN(e.target.value)} /></label>
          <label className={fieldLabel}>senders <Input className="w-24 font-mono" value={senders} onChange={e => setSenders(e.target.value)} /></label>
          <Button disabled={busy || 'error' in size} onClick={run}>{busy ? 'Running…' : 'Run benchmark'}</Button>
        </div>
        {'error' in size && <p role="alert" className="text-danger">{size.error}</p>}
      </Card>
      {progress && (
        <div className="space-y-1 text-sm">
          <div className="text-muted">{progress[0]}{progress[0] === 'signing' ? ` ${progress[1]}/${progress[2]}` : ''}</div>
          <progress className="h-2 w-full accent-accent" max={progress[2]} value={progress[1]} />
        </div>
      )}
      {last && <ResultView r={last} />}
      {last && <Button variant="ghost" onClick={() => open(last)}>Open in Explorer</Button>}
      {runs.length > 0 && (
        <Panel title="Session runs">
          <Table>
            <table className="w-full min-w-[32rem] text-sm">
              <thead><tr><th className={th}>run</th><th className={th}>TPS</th><th className={th}>p50</th><th className={th}>p99</th><th className={th}>verified</th><th /></tr></thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.handle.info.id} className="border-t border-line hover:bg-surface-hover">
                    <td className={`${td} font-medium`}>{r.name}</td>
                    <td className={`${td} font-mono`}>{r.result.tps === null ? '—' : f(r.result.tps)}</td>
                    <td className={`${td} font-mono`}>{f(r.result.latencyMs.p50)}</td>
                    <td className={`${td} font-mono`}>{f(r.result.latencyMs.p99)}</td>
                    <td className={`${td} ${r.result.verified ? 'text-success-text' : 'text-danger'}`}>{r.result.verified ? 'yes' : 'no'}</td>
                    <td className={`${td} text-right`}><Button variant="ghost" size="sm" onClick={() => open(r)}>Open in Explorer</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Table>
        </Panel>
      )}
      {sampled.length > 0 && (
        <Panel title="Latency distribution">
          <div className="p-4">
            <DistributionChart series={sampled.map(r => ({ id: r.handle.info.id, name: r.name, samples: r.result.latencySamplesMs! }))} />
          </div>
        </Panel>
      )}
    </div>
  )
}
