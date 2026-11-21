import { getAddress } from 'viem'

/** Every page's address carries `?chain=<registry id>&as=<persona>`; these helpers read and write them. */
type Persona = { label: string; address: string }

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The account's label when no other account has it, else its checksummed address. */
export function personaParam(address: string, accounts: Persona[]): string {
  const a = accounts.find(x => eq(x.address, address))
  return a && accounts.filter(x => x.label === a.label).length === 1 ? a.label : getAddress(address)
}

/** A label (case-sensitive, first match) or an address (any case) → the account's address. */
export function resolvePersona(as: string, accounts: Persona[]): string | undefined {
  return (accounts.find(x => x.label === as) ?? accounts.find(x => eq(x.address, as)))?.address
}

/** `path` with each param set, or removed when undefined; the others kept. */
export function withParams(path: string, params: Record<string, string | undefined>): string {
  const i = path.indexOf('?')
  const p = i < 0 ? path : path.slice(0, i)
  const sp = new URLSearchParams(i < 0 ? '' : path.slice(i + 1))
  for (const [k, v] of Object.entries(params)) v === undefined ? sp.delete(k) : sp.set(k, v)
  const s = sp.toString()
  return s ? `${p}?${s}` : p
}

/** Only an in-app hash path (`/swap?…`): no scheme, host, `//`, backslash or control characters. */
export function safeBack(back: string | null | undefined): string | undefined {
  return back && back.startsWith('/') && !back.startsWith('//') && !/[\\\x00-\x1f]/.test(back) ? back : undefined
}

export type Last = { chain?: string; as?: string }
type Decision = { chain?: string; account?: string; url?: { chain?: string; as?: string }; notices: string[]; last: Last }

/** What the URL sync does this round. `last` is the pair the URL and the selection last agreed on: a param that
 *  differs from it was changed in the address (a link, back/forward) and selects; otherwise the selection changed
 *  (or a navigation dropped the params) and the URL is rewritten. While a chain loads or a tx is in flight (`loading`), nothing — the URL's pair applies after. */
export function syncDecision(
  url: { chain?: string | null; as?: string | null },
  sel: { chain?: string; account?: string; loading: boolean },
  last: Last,
  known: { chains: string[]; accounts: Persona[] },
): Decision {
  if (sel.loading) return { notices: [], last }
  const d: Decision = { notices: [], last: {} }
  const uc = url.chain || undefined, ua = url.as || undefined

  let chain = sel.chain
  if (uc && uc !== last.chain && uc !== sel.chain) {
    if (known.chains.includes(uc)) d.chain = chain = uc
    else d.notices.push(`No chain ${uc} in this browser`)
  }

  const r = ua && resolvePersona(ua, known.accounts)
  let as = sel.account && personaParam(sel.account, known.accounts)
  if (ua && ua !== last.as) {
    if (r) {
      if (!sel.account || !eq(r, sel.account)) d.account = r
      as = eq(ua, r) ? ua : personaParam(r, known.accounts) // an ambiguous label becomes the address
    } else d.notices.push(`No account ${ua} in this browser`)
  } else if (ua && sel.account && eq(ua, sel.account)) as = ua // written as an address: keep it

  d.last = { chain, as }
  if (chain !== uc || as !== ua) d.url = { chain, as }
  return d
}
