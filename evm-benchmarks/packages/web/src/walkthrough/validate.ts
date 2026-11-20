import { parseAmount } from '../assets/ui'
import type { Walkthrough } from './types'

type Err = { step?: string; field: string; message: string }
const TYPES = ['account', 'chain', 'launchAsset', 'deploySwap', 'approve', 'makeOffer', 'take', 'view']
const KIND_OF: Record<string, string | undefined> = { account: 'account', chain: 'chain', launchAsset: 'asset', deploySwap: 'swap', makeOffer: 'offer' }
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
      use(field, args[field])
      const n = typeof args[field] === 'string' ? /^\$(\w+)$/.exec(args[field])?.[1] : undefined
      if (!n) e(field, `${field} must be a single $key`)
      else if (n in keys && kindOf(keys[n]) !== kind) e(field, `$${n} is not ${kind === 'asset' ? 'an asset' : `a ${kind}`}`)
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
      case 'account': case 'deploySwap': case 'chain': case 'launchAsset': case 'makeOffer':
        if (typeof s.key !== 'string' || !(s.key in keys)) e('key', 'Needs a declared key')
        else if (kindOf(keys[s.key]) !== KIND_OF[s.do]) e('key', `Key ${s.key} must be kind ${KIND_OF[s.do]}`)
        break
    }
    if (s.do === 'chain') {
      if (!Array.isArray(args.prefund)) e('args.prefund', 'prefund must be a list')
      else args.prefund.forEach((p: unknown) => use('args.prefund', p))
    }
    if (s.do === 'launchAsset') {
      if (typeof args.supply !== 'string' || !/^\d+(\.\d+)?$/.test(args.supply)) e('args.supply', 'supply must be a number')
      kindArg('issuer', 'account')
    }
    if (s.do === 'deploySwap' || s.do === 'approve' || s.do === 'makeOffer' || s.do === 'take') kindArg('from', 'account')
    if (s.do === 'approve') {
      amountArg('amount', args.amount)
      const j = index.get(args.before)
      if (j === undefined || j <= i) e('before', 'before must be the id of a later step')
      else if (!['makeOffer', 'take'].includes(steps[j].do)) e('before', 'before must be a makeOffer or take step')
    }
    if (s.do === 'makeOffer') {
      amountArg('sell', args.sell)
      amountArg('for', args.for)
      const err = priceError(keys, args.sell, args.for)
      if (err) e('for', err)
    }
    if (s.do === 'take') kindArg('offer', 'offer')
    if (s.do === 'view') {
      if (args.page === 'swap') { kindArg('base', 'asset'); kindArg('quote', 'asset') }
      else if (args.page === 'report') {
        const j = index.get(args.step)
        if (j === undefined || steps[j].do !== 'take') e('step', 'step must be the id of a take step')
      } else e('page', 'page must be swap or report')
    }
    for (const c of Array.isArray(s.expect) ? s.expect : []) {
      for (const f of ['balance', 'has', 'escrowed', 'offer']) if (typeof c?.[f] === 'string') {
        if (f === 'has' || f === 'escrowed') amountArg('expect', c[f]); else use('expect', c[f])
      }
    }
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
  // (F/10^fd) / (S/10^sd), at fd places: F*10^sd*10^fd must divide by S*10^fd
  if ((F.raw * 10n ** BigInt(S.d + F.d)) % (S.raw * 10n ** BigInt(F.d)) !== 0n)
    return `Price ${forText} per ${sell} is not exact at ${F.d} decimals`
}
