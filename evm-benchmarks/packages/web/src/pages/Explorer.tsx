import { useEffect, useState, type ReactNode } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import type { Abi } from 'viem'
import { useApp } from '../state'
import { contractsRegistry, type DeployedContract } from '../contracts/registry'
import { address, big, block, classify, tx } from '../explorer/data'
import { useLoad } from '../explorer/useLoad'
import { SelectedBlock } from '../explorer/SelectedBlock'
import { ChainView } from '../explorer/views/ChainView'
import { TableView } from '../explorer/views/TableView'
import { TimelineView } from '../explorer/views/TimelineView'
import type { Header } from '../explorer/window'
import { Pager } from '../ui/pager'
import { isErc20 } from '../components/Erc20Card'
import { show } from '../components/ReceiptView'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Input } from '../ui/input'
import { Notice } from '../ui/notice'
import { Panel } from '../ui/panel'
import { Table, td, th } from '../ui/table'
import { ExplorerIcon } from '../ui/icons'
import type { ChainHandle } from '../chain/handle'

const NotFound = ({ what }: { what: string }) => <Notice>{`Not found: ${what}`}</Notice>
const short = (s: string) => `${s.slice(0, 10)}…${s.slice(-6)}`
type Names = Map<string, DeployedContract>

const muted = 'text-sm text-muted'
const link = 'text-accent hover:underline'

const Addr = ({ a, names }: { a: string | null; names: Names }) =>
  a ? <Link title={a} className={`font-mono ${link}`} to={`/chains/address/${a}`}>{names.get(a.toLowerCase())?.name ?? short(a)}</Link> : <span className="text-muted">(create)</span>

function Block({ chain, names }: { chain: ChainHandle; names: Names }) {
  const { n = '' } = useParams()
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [n])
  const num = /^\d+$/.test(n) ? Number(n) : NaN
  const b = useLoad(() => block(chain, num, page), [chain, n, page])
  if (b === undefined) return <p className={muted}>Loading…</p>
  if (!b) return <NotFound what={`block ${n}`} />
  const h = b.header
  return (
    <div className="space-y-4">
      <Panel title={`Block ${num}`}>
        <Details>
          <Row k="Hash"><span className="font-mono text-xs" title={h.hash}>{h.hash}</span></Row>
          <Row k="Parent"><span className="font-mono text-xs" title={String(h.parentHash)}>{String(h.parentHash)}</span></Row>
          <Row k="Time">{new Date(Number(big(h.timestamp)) * 1000).toISOString()}</Row>
          <Row k="Transactions"><span className="font-mono">{b.txTotal}</span></Row>
        </Details>
      </Panel>
      {/* webevm reports gasUsed 0 and zero roots in headers, so they are omitted; see receipts for gas. */}
      <Panel title="Transactions">
        <Table>
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Hash</th><th className={th}>From</th><th className={th}>To</th><th className={`${th} text-right`}>Value (wei)</th></tr></thead>
            <tbody>
              {b.txs.map(t => (
                <tr key={t.hash} className="border-t border-line hover:bg-surface-hover">
                  <td className={td}><Link className={`font-mono text-xs ${link}`} title={t.hash} to={`/chains/tx/${t.hash}`}>{short(t.hash)}</Link></td>
                  <td className={`${td} text-xs`}><Addr a={t.from} names={names} /></td>
                  <td className={`${td} text-xs`}><Addr a={t.to} names={names} /></td>
                  <td className={`${td} text-right font-mono`}>{t.value.toString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Table>
        <Pager page={page} set={setPage} more={(page + 1) * 50 < b.txTotal} />
      </Panel>
    </div>
  )
}

const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
    <dt className="text-text-2">{k}</dt>
    <dd className="min-w-0 break-all">{children}</dd>
  </div>
)
const Details = ({ children }: { children: ReactNode }) => <dl className="space-y-3 p-4">{children}</dl>
const card = 'break-all rounded-lg border border-line bg-surface p-3 font-mono text-xs leading-relaxed'

function Tx({ chain, names }: { chain: ChainHandle; names: Names }) {
  const { hash = '' } = useParams()
  const abis = [...names.values()].map(c => c.abi as Abi)
  const t = useLoad(() => tx(chain, hash, abis), [chain, hash, names])
  if (t === undefined) return <p className={muted}>Loading…</p>
  if (!t) return <NotFound what={`transaction ${hash}`} />
  const { receipt: r } = t
  const bn = Number(big(r.blockNumber))
  const ok = r.status === '0x1'
  return (
    <Panel title="Transaction">
      <Details>
        <Row k="Hash"><span className="font-mono text-xs" title={t.tx.hash}>{t.tx.hash}</span></Row>
        <Row k="Status"><Badge variant={ok ? 'success' : 'danger'}>{ok ? 'success' : 'reverted'}</Badge></Row>
        <Row k="Block"><Link className={`font-mono ${link}`} to={`/chains/block/${bn}`}>{bn}</Link></Row>
        <Row k="From"><Addr a={t.tx.from} names={names} /></Row>
        <Row k="To"><Addr a={t.tx.to} names={names} /></Row>
        {r.contractAddress && <Row k="Created"><Addr a={r.contractAddress} names={names} /></Row>}
        <Row k="Value (wei)"><span className="font-mono">{big(t.tx.value).toString()}</span></Row>
        <Row k="Gas used"><span className="font-mono">{big(r.gasUsed).toString()}</span></Row>
      </Details>
      <div className="space-y-2 border-t border-line p-4">
        <span className="text-xs font-medium text-text-2">Input</span>
        <div className={card}>
          {t.decodedInput ? (
            <>
              <div className="font-medium text-accent">{t.decodedInput.functionName}</div>
              {t.decodedInput.args && <div>{show(t.decodedInput.args)}</div>}
            </>
          ) : t.tx.input}
        </div>
      </div>
      {r.logs.length > 0 && (
        <div className="space-y-2 border-t border-line p-4">
          <span className="text-xs font-medium text-text-2">Events</span>
          {r.logs.map((l, i) => {
            const ev = t.decodedLogs[i]
            const fields = ev?.args && typeof ev.args === 'object' ? Object.entries(ev.args) : []
            return (
              <div key={i} className={card}>
                <div className="text-muted">log {i} <Addr a={l.address} names={names} /></div>
                {ev ? (
                  <>
                    <div className="font-medium text-accent">{ev.eventName}</div>
                    {fields.map(([k, v]) => <div key={k}><span className="text-muted">{k}</span>: {show(v)}</div>)}
                  </>
                ) : (
                  <div>{l.topics[0]?.slice(0, 10) ?? 'anonymous'}… ({l.data.length / 2 - 1} bytes, undecoded)</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

function Address({ chain, names }: { chain: ChainHandle; names: Names }) {
  const { addr = '' } = useParams()
  const tokens = [...names.values()].filter(c => isErc20(c.abi as Abi)).map(c => ({ address: c.address, name: c.name, abi: c.abi as Abi }))
  const a = useLoad(() => address(chain, addr, tokens), [chain, addr, names])
  if (a === undefined) return <p className={muted}>Loading…</p>
  if (!a) return <NotFound what={`address ${addr}`} />
  const c = names.get(addr.toLowerCase())
  return (
    <Panel title={`${a.isContract ? 'Contract' : 'Address'}${c ? ` ${c.name}` : ''}`} badge={a.isContract ? <Badge variant="accent">contract</Badge> : undefined}>
      <Details>
        <Row k="Address"><span className="font-mono text-xs" title={addr}>{addr}</span></Row>
        <Row k="Balance (wei)"><span className="font-mono">{a.balance.toString()}</span></Row>
        <Row k="Nonce"><span className="font-mono">{a.nonce}</span></Row>
        {a.tokenBalances.map(t => <Row key={t.token} k={t.name}><span className="font-mono">{String(t.balance)}</span></Row>)}
      </Details>
    </Panel>
  )
}

export type ExplorerView = 'table' | 'chain' | 'timeline' | 'fisheye'

/** Fisheye arrives in a later task. */
function ActiveView({ view, chain, q, win, sel }: { view: ExplorerView; chain: ChainHandle; q: string; win: Win; sel?: number }) {
  if (view === 'table') return <TableView chain={chain} q={q} headers={win.headers} total={win.total} loading={win.loading} />
  if (view === 'chain') return <ChainView chain={chain} q={q} selected={sel} total={win.total} loading={win.loading} />
  if (view === 'timeline') return <TimelineView q={q} headers={win.headers} total={win.total} selected={sel} loading={win.loading} />
  return <Panel title={view[0]!.toUpperCase() + view.slice(1)}><p className={`${muted} p-4`}>Coming in this plan</p></Panel>
}
type Win = { headers: Header[]; total: number; loading: boolean }

/** The view plus the selected-block panel (beside it at lg, below on narrower screens). */
function Browse({ chain, view, q, win }: { chain: ChainHandle; view: ExplorerView; q: string; win: Win }) {
  const { n } = useParams()
  const sel = n !== undefined && /^\d+$/.test(n) ? Number(n) : undefined
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0"><ActiveView view={view} chain={chain} q={q} win={win} sel={sel} /></div>
      <SelectedBlock chain={chain} n={sel} tip={win.headers[0]?.number} loading={win.loading} />
    </div>
  )
}

export function Explorer({ view, win }: { view: ExplorerView; win: Win }) {
  const { chain } = useApp()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [miss, setMiss] = useState(false)
  const [names, setNames] = useState<Names>(new Map())
  useEffect(() => {
    if (!chain) return setNames(new Map())
    contractsRegistry.list(chain.info.id).then(
      cs => setNames(new Map(cs.map(c => [c.address.toLowerCase(), c]))),
      () => setNames(new Map()),
    )
  }, [chain])

  if (!chain) return <div className="space-y-4"><p className={muted}>Select a chain first.</p></div>

  const search = () => {
    const s = q.trim()
    const kind = classify(s)
    setMiss(kind === 'invalid')
    if (kind !== 'invalid') nav(`/chains/${kind}/${s}`)
  }
  return (
    <div className="space-y-4">
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); search() }}>
        <div className="relative min-w-0 flex-1">
          <ExplorerIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input aria-label="Search or filter" className="min-h-11 w-full pl-9" placeholder="Filter by block number or hash prefix; Enter to open a block, tx or address" value={q} onChange={e => { setQ(e.target.value); setMiss(false) }} />
        </div>
        <Button type="submit">Search</Button>
      </form>
      {miss && <NotFound what={q} />}
      <Routes>
        <Route index element={<Browse chain={chain} view={view} q={q} win={win} />} />
        <Route path="block/:n" element={<Browse chain={chain} view={view} q={q} win={win} />} />
        <Route path="block/:n/txs" element={<Block chain={chain} names={names} />} />
        <Route path="tx/:hash" element={<Tx chain={chain} names={names} />} />
        <Route path="address/:addr" element={<Address chain={chain} names={names} />} />
        <Route path="*" element={<NotFound what="page" />} />
      </Routes>
    </div>
  )
}
