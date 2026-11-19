import { useState } from 'react'
import { CHAIN_TYPE_BLURB, ChainTypeHelp } from '../components/ChainTypeHelp'
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
import { Input, Select } from '../ui/input'
import { Notice } from '../ui/notice'
import { Table } from '../ui/table'
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

  const size = parseBenchSize(n, senders)

  async function run() {
    if ('error' in size) return
    setBusy(true); setErr(undefined)
    try {
      const { result, handle } = await runInBrowser(
        { type, scenario, ...size, host: benchHost },
        (p, d, t) => setProgress([p, d, t]),
      )
      registry.addEphemeral(addRun(result, handle, type, scenario).handle)
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
    nav('/explorer')
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-semibold">Benchmark</h1>
      {err && <Notice>{err}</Notice>}
      <Card className="space-y-4 text-sm">
        <h2 className="font-semibold">New run</h2>
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {(['plain', 'sequencer'] as const).map(t => (
              <label key={t} className={`block cursor-pointer rounded-lg border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${type === t ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface hover:bg-surface-hover'}`}>
                <input className="mr-2 accent-accent" type="radio" name="type" checked={type === t} onChange={() => setType(t)} />
                <b>{t}</b>
                <span className="mt-1 block text-muted">{CHAIN_TYPE_BLURB[t]}</span>
              </label>
            ))}
          </div>
          <ChainTypeHelp />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">scenario <Select value={scenario} onChange={e => setScenario(e.target.value as keyof typeof scenarios)}>{Object.keys(scenarios).map(s => <option key={s}>{s}</option>)}</Select></label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">N <Input className="w-28 font-mono" value={n} onChange={e => setN(e.target.value)} /></label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">senders <Input className="w-24 font-mono" value={senders} onChange={e => setSenders(e.target.value)} /></label>
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
        <section className="overflow-hidden rounded-xl border border-line-strong bg-surface">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Session runs</h2>
          <Table>
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead><tr className="text-xs text-muted"><th className="px-4 py-2 font-medium">run</th><th className="px-2 py-2 font-medium">TPS</th><th className="px-2 py-2 font-medium">p50</th><th className="px-2 py-2 font-medium">p99</th><th className="px-2 py-2 font-medium">verified</th><th /></tr></thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.handle.info.id} className="border-t border-line hover:bg-surface-hover">
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-2 font-mono">{r.result.tps === null ? '—' : f(r.result.tps)}</td>
                    <td className="px-2 font-mono">{f(r.result.latencyMs.p50)}</td>
                    <td className="px-2 font-mono">{f(r.result.latencyMs.p99)}</td>
                    <td className={`px-2 ${r.result.verified ? 'text-success-text' : 'text-danger'}`}>{r.result.verified ? 'yes' : 'no'}</td>
                    <td className="px-2 text-right"><Button variant="ghost" size="sm" onClick={() => open(r)}>Open in Explorer</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Table>
        </section>
      )}
    </div>
  )
}
