import { parsePrice } from '@evmb/orderbook'
import { parseAmount } from '../assets/ui'
import type { Walkthrough } from './types'
import { assetChainKey, chainKeyOf } from './resolve'

type Err = { step?: string; field: string; message: string }
const TYPES = ['account', 'chain', 'launchAsset', 'deploySwap', 'approve', 'makeOffer', 'take', 'view', 'deployVenue', 'placeOrder', 'cancelOrder', 'transfer', 'deployPool', 'addLiquidity', 'removeLiquidity', 'poolSwap', 'deployHashLock', 'lockFunds', 'claimLock', 'refundLock', 'advanceBlocks']
const PHASES = ['offered', 'answered', 'claimedB', 'complete', 'refundedA', 'refundedB', 'refundedBoth', 'expiring']
const OUTCOMES = ['completed', 'refunded (maker)', 'refunded (taker)', 'refunded (both)', 'taker lost', 'maker lost', 'stuck']
/** steps that need no chain of their own */
const CHAINLESS = ['account', 'chain', 'approve', 'view']
const STATUSES = ['open', 'partial', 'filled', 'cancelled', 'failed', 'unfunded']
const KIND_OF: Record<string, string | undefined> = { account: 'account', chain: 'chain', launchAsset: 'asset', deploySwap: 'swap', makeOffer: 'offer', deployVenue: 'venue', placeOrder: 'order', deployPool: 'pool', deployHashLock: 'hashLock' }
const isObj = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x)
const kindOf = (def: unknown) => (isObj(def) ? Object.keys(def)[0] : undefined)
const names = (s: string) => [...s.matchAll(/\$(\w+)/g)].map(m => m[1])

export function validate(json: unknown): { ok: Walkthrough } | { errors: Err[] } {
  const errors: Err[] = []
  const bad = (field: string, message: string, step?: string) => errors.push({ step, field, message })
  if (!isObj(json)) return { errors: [{ field: '', message: 'Not an object' }] }
  for (const f of ['id', 'title', 'summary']) if (typeof json[f] !== 'string' || !json[f]) bad(f, `Missing ${f}`)
  if (!isObj(json.keys)) bad('keys', 'Missing keys')
  if (!Array.isArray(json.steps)) bad('steps', 'Missing steps')
  if (errors.length) return { errors }
  const keys: Record<string, any> = json.keys
  const steps: any[] = json.steps
  const index = new Map<string, number>(steps.map((s, i) => [s?.id, i]))
  const filled = new Set<string>() // keys whose step came earlier
  const seen = new Set<string>()
  const chainKeys = Object.keys(keys).filter(k => kindOf(keys[k]) === 'chain')
  const w = json as unknown as Walkthrough
  /** resolve helpers on a file not yet valid: undefined where its shape is off */
  const safe = <T>(f: () => T) => { try { return f() } catch { return undefined } }
  const stepChain = (s: any) => safe(() => chainKeyOf(w, s))
  const assetChain = (text: unknown) => safe(() => assetChainKey(w, names(String(text ?? ''))[0]))
  /** the opening lockFunds step `ref` names, if it comes before step i */
  const openingAt = (ref: unknown, i: number) => {
    const j = index.get(ref as string)
    return j !== undefined && j < i && steps[j]?.do === 'lockFunds' && isObj(steps[j].args) && steps[j].args.swap === undefined ? steps[j] : undefined
  }

  steps.forEach((s, i) => {
    const id = isObj(s) && typeof s.id === 'string' ? s.id : `#${i}`
    const e = (field: string, message: string) => bad(field, message, id)
    if (!isObj(s)) return e('', 'Step is not an object')
    if (typeof s.id !== 'string' || !s.id) e('id', 'Missing id')
    else if (seen.has(s.id)) e('id', `Duplicate step id ${s.id}`)
    seen.add(s.id)
    for (const f of ['title', 'text']) if (typeof s[f] !== 'string' || !s[f]) e(f, `Missing ${f}`)
    if (!TYPES.includes(s.do)) return e('do', `Unknown step type ${String(s.do)}`)
    const args = isObj(s.args) ? s.args : {}

    // Every $name must be declared and filled by an earlier step.
    const use = (field: string, text: unknown) => {
      if (typeof text !== 'string') return e(field, `${field} must be a string`)
      for (const n of names(text)) {
        if (!(n in keys)) e(field, `$${n} is not a declared key`)
        else if (!filled.has(n)) e(field, `$${n} is used before its step`)
      }
    }
    const kindArg = (field: string, kind: string) => {
      if (typeof args[field] !== 'string') return e(field, `${field} must be a single $key`)
      use(field, args[field])
      const n = /^\$(\w+)$/.exec(args[field])?.[1]
      if (!n) e(field, `${field} must be a single $key`)
      else if (n in keys && kindOf(keys[n]) !== kind) e(field, `$${n} is not ${/^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`}`)
      return n
    }
    const amountArg = (field: string, text: unknown) => {
      use(field, text)
      if (typeof text !== 'string') return
      const m = /^(\S+)\s+\$(\w+)$/.exec(text)
      const def = m && keys[m[2]]
      if (!m || kindOf(def) !== 'asset') return e(field, `${field} must be "<amount> $ASSET"`)
      const p = parseAmount(m[1], def.asset.decimals)
      if ('error' in p) e(field, `${text}: ${p.error}`)
    }

    switch (s.do) {
      case 'placeOrder': if (s.key === undefined) break // a taker filled in full rests nothing, so may have no key
      // falls through
      case 'account': case 'deploySwap': case 'chain': case 'launchAsset': case 'makeOffer': case 'deployVenue': case 'deployPool': case 'deployHashLock':
        if (typeof s.key !== 'string' || !(s.key in keys)) e('key', 'Needs a declared key')
        else if (kindOf(keys[s.key]) !== KIND_OF[s.do]) e('key', `Key ${s.key} must be kind ${KIND_OF[s.do]}`)
        break
    }
    if (args.chain !== undefined) kindArg('chain', 'chain')
    else if (chainKeys.length > 1 && !CHAINLESS.includes(s.do))
      e('chain', `Name the chain (${chainKeys.map(k => `$${k}`).join(' or ')}): this walkthrough has ${chainKeys.length === 2 ? 'two' : chainKeys.length}`)
    if (s.do === 'chain') {
      if (!Array.isArray(args.prefund)) e('args.prefund', 'prefund must be a list')
      else args.prefund.forEach((p: unknown) => use('args.prefund', p))
    }
    if (s.do === 'launchAsset') {
      if (typeof args.supply !== 'string' || !/^\d+(\.\d+)?$/.test(args.supply)) e('args.supply', 'supply must be a number')
      kindArg('issuer', 'account')
    }
    if (['deploySwap', 'approve', 'makeOffer', 'take', 'deployVenue', 'placeOrder', 'cancelOrder', 'transfer', 'deployPool', 'addLiquidity', 'removeLiquidity', 'poolSwap', 'deployHashLock', 'lockFunds', 'claimLock', 'refundLock'].includes(s.do)) kindArg('from', 'account')
    if (s.do === 'approve') {
      amountArg('amount', args.amount)
      const j = index.get(args.before)
      if (j === undefined || j <= i) e('before', 'before must be the id of a later step')
      else if (!['makeOffer', 'take', 'placeOrder', 'addLiquidity', 'poolSwap', 'lockFunds'].includes(steps[j].do)) e('before', 'before must be a makeOffer, take, placeOrder, addLiquidity, poolSwap or lockFunds step')
      else if (steps[j].do === 'lockFunds') {
        // what the lock gives: the opening its amount, an answer what the opening wants
        const o = isObj(steps[j].args) ? steps[j].args : {}
        const open = o.swap === undefined ? o : steps.find(x => x?.id === o.swap)?.args ?? {}
        const give = names(String((o.swap === undefined ? open.amount : open.for) ?? ''))[0]
        const got = typeof args.amount === 'string' ? names(args.amount)[0] : undefined
        if (give && got && give !== got) e('amount', `amount must be in $${give}, what the lock gives`)
      } else if (steps[j].do === 'placeOrder') {
        // what the order gives: the base for a sell, the quote for a buy
        const o = isObj(steps[j].args) ? steps[j].args : {}
        const give = o.side === 'buy' ? names(String(o.quote ?? ''))[0] : names(String(o.amount ?? ''))[0]
        const got = typeof args.amount === 'string' ? names(args.amount)[0] : undefined
        if (give && got && give !== got) e('amount', `amount must be in $${give}, what the order gives`)
      } else if (steps[j].do !== 'makeOffer' && steps[j].do !== 'take') {
        // the pool spends what the step pays: the swap's pay asset, either of the add's two
        const o = isObj(steps[j].args) ? steps[j].args : {}
        const pays = (steps[j].do === 'poolSwap' ? [o.pay] : [o.base, o.quote]).map(t => names(String(t ?? ''))[0])
        const got = typeof args.amount === 'string' ? names(args.amount)[0] : undefined
        if (got && pays[0] && !pays.includes(got)) e('amount', `amount must be in ${pays.map(p => `$${p}`).join(' or ')}, what the step pays`)
      }
    }
    if (s.do === 'makeOffer') {
      amountArg('sell', args.sell)
      amountArg('for', args.for)
      const err = priceError(keys, args.sell, args.for)
      if (err) e('for', err)
    }
    if (s.do === 'take') kindArg('offer', 'offer')
    if (s.do === 'deployVenue') {
      const own = kindOf(keys[s.key]) === 'venue' ? keys[s.key].venue.venue : undefined
      if (args.venue !== 'onchain' && args.venue !== 'offchain') e('venue', 'venue must be onchain or offchain')
      else if (own && own !== args.venue) e('venue', `venue does not match key ${s.key} (${own})`)
    }
    if (s.do === 'placeOrder') {
      kindArg('venue', 'venue')
      if (args.side !== 'buy' && args.side !== 'sell') e('side', 'side must be buy or sell')
      amountArg('amount', args.amount)
      const quote = kindArg('quote', 'asset'), base = typeof args.amount === 'string' ? /\$(\w+)$/.exec(args.amount)?.[1] : undefined
      if (quote && quote === base) e('quote', "quote must differ from the amount's asset")
      if (args.type === 'limit') {
        if (typeof args.price !== 'string') e('price', 'A limit order needs a price')
        else if (quote && kindOf(keys[quote]) === 'asset') {
          try { parsePrice(args.price, keys[quote].asset.decimals) } catch (x) { e('price', `${args.price}: ${(x as Error).message}`) }
        }
      } else if (args.type === 'market') { if (args.price !== undefined) e('price', 'A market order takes no price') }
      else e('type', 'type must be limit or market')
    }
    if (s.do === 'cancelOrder') kindArg('order', 'order')
    if (s.do === 'transfer') { kindArg('to', 'account'); amountArg('amount', args.amount) }
    if (s.do === 'deployPool') {
      const b = kindArg('base', 'asset'), q = kindArg('quote', 'asset')
      if (b && b === q) e('quote', 'quote must differ from base')
    }
    // the pool's two asset keys, from the deployPool that filled it
    const poolTokens = () => {
      const n = kindArg('pool', 'pool')
      const d = n && steps.find(x => x?.do === 'deployPool' && x.key === n)
      return d && isObj(d.args) ? [names(String(d.args.base ?? ''))[0], names(String(d.args.quote ?? ''))[0]] : undefined
    }
    if (s.do === 'addLiquidity') {
      const t = poolTokens()
      amountArg('base', args.base); amountArg('quote', args.quote)
      const b = names(String(args.base ?? ''))[0], q = names(String(args.quote ?? ''))[0]
      if (t && b && q && (b === q || !t.includes(b) || !t.includes(q))) e('base', "base and quote must be the pool's tokens, one each")
    }
    if (s.do === 'removeLiquidity') {
      poolTokens()
      if (!Number.isInteger(args.percent) || args.percent < 1 || args.percent > 100) e('percent', 'percent must be a whole number from 1 to 100')
    }
    if (s.do === 'poolSwap') {
      const t = poolTokens()
      amountArg('pay', args.pay)
      const p = names(String(args.pay ?? ''))[0]
      if (t && p && p in keys && !t.includes(p)) e('pay', "pay must be one of the pool's tokens")
      if (![10, 50, 100].includes(args.slippageBps)) e('slippageBps', 'slippageBps must be 10, 50 or 100 (the page offers 0.1%, 0.5%, 1%)')
    }
    /** each of a swap's chains needs a HashLock deployed by an earlier step */
    const hashLocks = (...ks: unknown[]) => {
      for (const k of new Set(ks)) if (typeof k === 'string' && !steps.slice(0, i).some((x: any) => isObj(x) && x.do === 'deployHashLock' && stepChain(x) === k))
        e('chain', `Deploy a HashLock on $${k} first (a deployHashLock step before this one)`)
    }
    if (s.do === 'lockFunds') {
      if (!Number.isInteger(args.timeout) || args.timeout < 1 || args.timeout > 1e9) e('timeout', 'timeout must be a whole number of blocks (1 or more)')
      if (args.swap !== undefined) {
        const o = openingAt(args.swap, i)
        if (!o) e('swap', 'swap must be the id of an earlier lockFunds that opens a swap')
        else {
          if (stepChain(s) !== assetChain(o.args.for)) e('chain', 'An answer locks on the chain of the asset the opening wants')
          if (args.from !== o.args.to) e('from', `An answer comes from the account the opening lock is addressed to (${String(o.args.to)})`)
          hashLocks(stepChain(o), assetChain(o.args.for))
        }
        if (args.unsafe !== undefined && args.unsafe !== true) e('unsafe', 'unsafe must be true (the page\'s "Lock anyway") or left out')
      } else {
        kindArg('to', 'account'); amountArg('amount', args.amount); amountArg('for', args.for)
        if (args.unsafe !== undefined) e('unsafe', 'Only an answer can be unsafe')
        if (assetChain(args.amount) && assetChain(args.amount) !== stepChain(s)) e('amount', 'amount must be an asset on this chain')
        if (assetChain(args.for) && assetChain(args.for) === stepChain(s)) e('for', 'for must be an asset on the other chain')
        hashLocks(stepChain(s), assetChain(args.for))
      }
    }
    if (s.do === 'claimLock' || s.do === 'refundLock') {
      const o = openingAt(args.swap, i)
      if (!o) e('swap', 'swap must be the id of an earlier lockFunds that opens a swap')
      else {
        if (![stepChain(o), assetChain(o.args.for)].includes(stepChain(s))) e('chain', "chain must be one of the swap's two chains")
        hashLocks(stepChain(o), assetChain(o.args.for))
      }
    }
    if (s.do === 'advanceBlocks' && (!Number.isInteger(args.blocks) || args.blocks < 1 || args.blocks > 9999)) e('blocks', 'blocks must be a whole number from 1 to 9999 (the page\'s box)')
    if (s.do === 'view') {
      if (args.page === 'swap') { kindArg('base', 'asset'); kindArg('quote', 'asset') }
      else if (args.page === 'trade') { kindArg('venue', 'venue'); kindArg('base', 'asset'); kindArg('quote', 'asset') }
      else if (args.page === 'pool') kindArg('pool', 'pool')
      else if (args.page === 'report') {
        const j = index.get(args.step)
        if (j === undefined || steps[j].do !== 'take') e('step', 'step must be the id of a take step')
      } else e('page', 'page must be swap, trade, pool or report')
    }
    if (s.expect !== undefined && !Array.isArray(s.expect)) e('expect', 'expect must be a list')
    for (const c of Array.isArray(s.expect) ? s.expect : []) {
      if (!isObj(c)) { e('expect', 'Check is not an object'); continue }
      const keyOf = (t: unknown, kind: string) => {
        const n = typeof t === 'string' ? /^\$(\w+)$/.exec(t)?.[1] : undefined
        if (!n) return e('expect', `Expected a single $key, got ${String(t)}`)
        use('expect', t)
        if (n in keys && kindOf(keys[n]) !== kind) e('expect', `$${n} is not a${kind === 'account' || kind === 'order' ? 'n ' + kind : ' ' + kind}`)
      }
      if ('balance' in c) { keyOf(c.balance, 'account'); amountArg('expect', c.has) }
      else if ('escrowed' in c) amountArg('expect', c.escrowed)
      else if ('offer' in c) {
        keyOf(c.offer, 'offer')
        if (!['Open', 'Filled', 'Cancelled'].includes(c.status)) e('expect', `Unknown offer status ${String(c.status)}`)
      } else if ('order' in c) {
        keyOf(c.order, 'order')
        if (!STATUSES.includes(c.status)) e('expect', `Unknown order status ${String(c.status)}`)
        if (c.filled !== undefined) amountArg('expect', c.filled)
      } else if ('trades' in c) {
        keyOf(c.trades, 'venue')
        if (!Number.isInteger(c.count) || c.count < 0) e('expect', 'count must be a whole number')
      } else if ('kGrew' in c) {
        keyOf(c.pool, 'pool')
        if (c.kGrew !== true) e('expect', 'kGrew must be true')
      } else if ('swap' in c) {
        if (!openingAt(c.swap, i + 1)) e('expect', 'swap must be the id of a lockFunds that opens a swap, at or before this step')
        if (!PHASES.includes(c.phase)) e('expect', `Unknown phase ${String(c.phase)}`)
      } else if ('report' in c) {
        if (!openingAt(c.report, i + 1)) e('expect', 'report must be the id of a lockFunds that opens a swap, at or before this step')
        if (!OUTCOMES.includes(c.outcome)) e('expect', `Unknown outcome ${String(c.outcome)}`)
        if (c.unsafe !== undefined && typeof c.unsafe !== 'boolean') e('expect', 'unsafe must be true or false')
      } else if ('outcome' in c) {
        if (!['taken', 'reverted'].includes(c.outcome)) e('expect', `Unknown outcome ${String(c.outcome)}`)
        if (c.error !== undefined && typeof c.error !== 'string') e('expect', 'error must be a string')
      } else e('expect', 'Unknown check')
    }
    if (['approve', 'take', 'view', 'cancelOrder', 'transfer', 'addLiquidity', 'removeLiquidity', 'poolSwap', 'lockFunds', 'claimLock', 'refundLock', 'advanceBlocks'].includes(s.do) && s.key !== undefined) e('key', `${s.do} steps create nothing, so take no key`)
    if (typeof s.key === 'string') {
      if (filled.has(s.key)) e('key', `Key ${s.key} is filled twice`)
      filled.add(s.key)
    }
  })
  for (const k of Object.keys(keys)) if (!filled.has(k)) bad('keys', `Key ${k} is never filled by a step`)
  return errors.length ? { errors } : { ok: json as unknown as Walkthrough }
}

/** price = for/sell must be exact at the `for` asset's initial decimals. */
function priceError(keys: Record<string, any>, sell: unknown, forText: unknown): string | undefined {
  const parse = (t: unknown) => {
    const m = typeof t === 'string' ? /^(\S+)\s+\$(\w+)$/.exec(t) : null
    const d = m && keys[m[2]]?.asset?.decimals
    const p = m && d !== undefined ? parseAmount(m[1], d) : undefined
    return p && 'ok' in p ? { raw: p.ok, d: d as number } : undefined
  }
  const S = parse(sell), F = parse(forText)
  if (!S || !F || S.raw === 0n) return undefined // reported by amountArg
  // (F/10^fd) / (S/10^sd) has at most fd places iff F*10^sd divides by S
  if ((F.raw * 10n ** BigInt(S.d)) % S.raw !== 0n)
    return `Price ${forText} per ${sell} is not exact at ${F.d} decimals`
}
