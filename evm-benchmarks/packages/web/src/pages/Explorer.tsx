import { useEffect, useState, type ReactNode } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import type { Abi } from 'viem'
import { useApp } from '../state'
import { contractsRegistry, type DeployedContract } from '../contracts/registry'
import { address, big, block, classify, latestBlocks, tx } from '../explorer/data'
import { isErc20 } from '../components/Erc20Card'
import { show } from '../components/ReceiptView'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import type { ChainHandle } from '../chain/handle'

const input = 'rounded-md border border-slate-300 px-2 py-1 text-sm'
const NotFound = ({ what }: { what: string }) => <p className="text-sm text-slate-600">Not found: {what}</p>
const short = (s: string) => `${s.slice(0, 10)}…${s.slice(-6)}`
type Names = Map<string, DeployedContract>

/** Run `f` when deps change; `undefined` = loading, `null` = not found. Rejections read as not found. */
function useLoad<T>(f: () => Promise<T | null>, deps: unknown[]) {
  const [v, setV] = useState<T | null | undefined>()
  useEffect(() => {
    let live = true
    setV(undefined)
    f().then(x => live && setV(x), () => live && setV(null))
    return () => { live = false }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return v
}

const Addr = ({ a, names }: { a: string | null; names: Names }) =>
  a ? <Link className="font-mono underline" to={`/explorer/address/${a}`}>{names.get(a.toLowerCase())?.name ?? short(a)}</Link> : <span>(create)</span>

function Pager({ page, set, more }: { page: number; set(p: number): void; more: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button variant="ghost" disabled={page === 0} onClick={() => set(page - 1)}>Prev</Button>
      <span>page {page + 1}</span>
      <Button variant="ghost" disabled={!more} onClick={() => set(page + 1)}>Next</Button>
    </div>
  )
}

function Latest({ chain }: { chain: ChainHandle }) {
  const [page, setPage] = useState(0)
  const rows = useLoad(() => latestBlocks(chain, page), [chain, page])
  return (
    <Card className="space-y-2">
      <h2 className="font-medium">Latest blocks</h2>
      {rows === undefined ? <p className="text-sm">Loading…</p> : rows.length === 0 ? <p className="text-sm">No blocks.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr><th>Block</th><th>Hash</th><th>Time</th><th>Txs</th></tr></thead>
          <tbody>
            {rows.map(b => (
              <tr key={b.number}>
                <td><Link className="underline" to={`/explorer/block/${b.number}`}>{b.number}</Link></td>
                <td className="font-mono">{short(b.hash)}</td>
                <td>{new Date(b.timestamp * 1000).toISOString()}</td>
                <td>{b.txCount}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <Pager page={page} set={setPage} more={rows?.length === 20} />
    </Card>
  )
}

function Block({ chain, names }: { chain: ChainHandle; names: Names }) {
  const { n = '' } = useParams()
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [n])
  const num = /^\d+$/.test(n) ? Number(n) : NaN
  const b = useLoad(() => block(chain, num, page), [chain, n, page])
  if (b === undefined) return <p className="text-sm">Loading…</p>
  if (!b) return <NotFound what={`block ${n}`} />
  const h = b.header
  return (
    <Card className="space-y-2">
      <h2 className="font-medium">Block {num}</h2>
      <dl className="grid grid-cols-[8rem_1fr] gap-1 text-sm">
        <dt>Hash</dt><dd className="font-mono break-all">{h.hash}</dd>
        <dt>Parent</dt><dd className="font-mono break-all">{String(h.parentHash)}</dd>
        <dt>Time</dt><dd>{new Date(Number(big(h.timestamp)) * 1000).toISOString()}</dd>
        <dt>Transactions</dt><dd>{b.txTotal}</dd>
      </dl>
      {/* webevm reports gasUsed 0 and zero roots in headers, so they are omitted; see receipts for gas. */}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr><th>Hash</th><th>From</th><th>To</th><th>Value (wei)</th></tr></thead>
        <tbody>
          {b.txs.map(t => (
            <tr key={t.hash}>
              <td><Link className="font-mono underline" to={`/explorer/tx/${t.hash}`}>{short(t.hash)}</Link></td>
              <td><Addr a={t.from} names={names} /></td>
              <td><Addr a={t.to} names={names} /></td>
              <td>{t.value.toString()}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <Pager page={page} set={setPage} more={(page + 1) * 50 < b.txTotal} />
    </Card>
  )
}

const Row = ({ k, children }: { k: string; children: ReactNode }) => <><dt>{k}</dt><dd className="break-all">{children}</dd></>

function Tx({ chain, names }: { chain: ChainHandle; names: Names }) {
  const { hash = '' } = useParams()
  const abis = [...names.values()].map(c => c.abi as Abi)
  const t = useLoad(() => tx(chain, hash, abis), [chain, hash, names])
  if (t === undefined) return <p className="text-sm">Loading…</p>
  if (!t) return <NotFound what={`transaction ${hash}`} />
  const { receipt: r } = t
  const bn = Number(big(r.blockNumber))
  return (
    <Card className="space-y-2">
      <h2 className="font-medium">Transaction</h2>
      <dl className="grid grid-cols-[8rem_1fr] gap-1 text-sm">
        <Row k="Hash"><span className="font-mono">{t.tx.hash}</span></Row>
        <Row k="Status">{r.status === '0x1' ? 'success' : 'reverted'}</Row>
        <Row k="Block"><Link className="underline" to={`/explorer/block/${bn}`}>{bn}</Link></Row>
        <Row k="From"><Addr a={t.tx.from} names={names} /></Row>
        <Row k="To"><Addr a={t.tx.to} names={names} /></Row>
        {r.contractAddress && <Row k="Created"><Addr a={r.contractAddress} names={names} /></Row>}
        <Row k="Value (wei)">{big(t.tx.value).toString()}</Row>
        <Row k="Gas used">{big(r.gasUsed).toString()}</Row>
        <Row k="Input"><span className="font-mono">{t.decodedInput ? show(t.decodedInput) : t.tx.input}</span></Row>
      </dl>
      {r.logs.map((l, i) => (
        <div key={i} className="font-mono text-xs break-all">
          log {i} <Addr a={l.address} names={names} />: {t.decodedLogs[i] ? show(t.decodedLogs[i]) : `${l.topics[0]?.slice(0, 10) ?? 'anonymous'}… (${l.data.length / 2 - 1} bytes, undecoded)`}
        </div>
      ))}
    </Card>
  )
}

function Address({ chain, names }: { chain: ChainHandle; names: Names }) {
  const { addr = '' } = useParams()
  const tokens = [...names.values()].filter(c => isErc20(c.abi as Abi)).map(c => ({ address: c.address, name: c.name, abi: c.abi as Abi }))
  const a = useLoad(() => address(chain, addr, tokens), [chain, addr, names])
  if (a === undefined) return <p className="text-sm">Loading…</p>
  if (!a) return <NotFound what={`address ${addr}`} />
  const c = names.get(addr.toLowerCase())
  return (
    <Card className="space-y-2">
      <h2 className="font-medium">{a.isContract ? 'Contract' : 'Address'}{c && ` ${c.name}`}</h2>
      <dl className="grid grid-cols-[8rem_1fr] gap-1 text-sm">
        <Row k="Address"><span className="font-mono">{addr}</span></Row>
        <Row k="Balance (wei)">{a.balance.toString()}</Row>
        <Row k="Nonce">{a.nonce}</Row>
        {a.tokenBalances.map(t => <Row key={t.token} k={t.name}>{String(t.balance)}</Row>)}
      </dl>
    </Card>
  )
}

export function Explorer() {
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

  if (!chain) return <div className="space-y-4"><h1 className="text-xl font-semibold">Explorer</h1><p className="text-sm">Select a chain first.</p></div>

  const search = () => {
    const s = q.trim()
    const kind = classify(s)
    setMiss(kind === 'invalid')
    if (kind !== 'invalid') nav(`/explorer/${kind}/${s}`)
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Explorer</h1>
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); search() }}>
        <input aria-label="Search" className={`${input} min-w-0 flex-1`} placeholder="Block number, tx hash or address" value={q} onChange={e => { setQ(e.target.value); setMiss(false) }} />
        <Button type="submit">Search</Button>
      </form>
      {miss && <NotFound what={q} />}
      <Routes>
        <Route index element={<Latest chain={chain} />} />
        <Route path="block/:n" element={<Block chain={chain} names={names} />} />
        <Route path="tx/:hash" element={<Tx chain={chain} names={names} />} />
        <Route path="address/:addr" element={<Address chain={chain} names={names} />} />
        <Route path="*" element={<NotFound what="page" />} />
      </Routes>
    </div>
  )
}
