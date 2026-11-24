import { test, expect } from 'bun:test'
import { validate } from '../src/walkthrough/validate'
import { ref, amount, uniqueName } from '../src/walkthrough/resolve'
import type { Run, Walkthrough } from '../src/walkthrough/types'
import { bundled } from '../walkthroughs'

const gbp = bundled.find(w => w.id === 'gbp-usd')!
const clone = (): any => structuredClone(gbp)
const errs = (j: unknown) => ('errors' in validate(j) ? (validate(j) as any).errors : [])
const has = (j: unknown, field: string, re: RegExp) => errs(j).some((e: any) => e.field === field && re.test(e.message))

test('bundled files validate', () => {
  expect(bundled.length).toBe(8)
  for (const w of bundled) expect(validate(w)).toEqual({ ok: w })
})

test('take-without-approval has no bobOk and expects a revert', () => {
  const w = bundled.find(x => x.id === 'take-without-approval')!
  expect(w.steps.map(s => s.id)).not.toContain('bobOk')
  expect(w.steps.find(s => s.id === 'take')!.expectRevert).toBe(true)
  expect(w.steps.at(-1)!.do).toBe('view')
})

test('unknown do', () => {
  const j = clone(); j.steps[0].do = 'teleport'
  expect(has(j, 'do', /Unknown step type/)).toBe(true)
})
test('duplicate step id', () => {
  const j = clone(); j.steps[1].id = 'alice'
  expect(has(j, 'id', /Duplicate/)).toBe(true)
})
test('$name used before its step', () => {
  const j = clone(); j.steps.unshift(j.steps.splice(2, 1)[0]) // chain before alice/bob
  expect(errs(j).some((e: any) => e.step === 'chain' && e.field === 'args.prefund' && /before its step/.test(e.message))).toBe(true)
})
test('check shapes', () => {
  const j = clone(); j.steps.find((s: any) => s.id === 'take').expect[0].status = 'Fillled'
  expect(has(j, 'expect', /Unknown offer status/)).toBe(true)
  const k = clone(); k.steps.find((s: any) => s.id === 'take').expect[1].balance = '$GBP'
  expect(has(k, 'expect', /not an account/)).toBe(true)
  const m = clone(); m.steps[0].expect = 'x'
  expect(has(m, 'expect', /must be a list/)).toBe(true)
})
test('approve/take/view take no key', () => {
  const j = clone(); j.steps.find((s: any) => s.id === 'aliceOk').key = 'swap'
  expect(has(j, 'key', /take no key/)).toBe(true)
})
test('missing from arg reports once', () => {
  const j = clone(); delete j.steps.find((s: any) => s.id === 'swap').args.from
  expect(errs(j).filter((e: any) => e.step === 'swap').length).toBe(1)
})
test('undeclared key', () => {
  const j = clone(); j.steps[2].args.prefund = ['$alice', '$carol']
  expect(has(j, 'args.prefund', /not a declared key/)).toBe(true)
})
test('key filled twice', () => {
  const j = clone(); j.steps[1].key = 'alice'
  expect(has(j, 'key', /filled twice/)).toBe(true)
})
test('approve.before pointing backwards', () => {
  const j = clone(); j.steps.find((s: any) => s.id === 'bobOk').args.before = 'offer'
  expect(has(j, 'before', /later step/)).toBe(true)
})
test('missing text', () => {
  const j = clone(); delete j.steps[0].text
  expect(has(j, 'text', /Missing/)).toBe(true)
})
test('price exactness', () => {
  const ok = clone(); ok.keys.USD.asset.decimals = 2
  const o = ok.steps.find((s: any) => s.id === 'offer').args
  o.sell = '1 $GBP'; o.for = '1 $USD'
  expect(has(ok, 'for', /not exact/)).toBe(false)
  o.sell = '3 $GBP'
  expect(has(ok, 'for', /not exact/)).toBe(true)
})

const run = (decimals: number): Run => ({
  walkthrough: 'x', started: '', edited: false, steps: {},
  values: { GBP: { address: '0x0000000000000000000000000000000000000001', symbol: 'GBP', name: 'Pound', decimals } },
})
test('ref throws naming step and key', () => {
  expect(() => ref(run(2), '$USD', 'usd')).toThrow('Step usd: $USD has no value yet')
  expect((ref(run(2), '$GBP') as any).symbol).toBe('GBP')
})
test('amount uses actual decimals', () => {
  expect(amount(run(4), '1.5 $GBP').raw).toBe(15000n)
  expect(() => amount(run(2), '1.555 $GBP')).toThrow()
})
test('uniqueName', () => {
  expect(uniqueName('Example', ['Example', 'Example 2'])).toBe('Example 3')
  expect(uniqueName('Example', [])).toBe('Example')
})

const book = (kind: 'onchain' | 'offchain') => bundled.find(w => w.id === `gbp-usd-book-${kind}`)!
const bookClone = (): any => structuredClone(book('onchain'))
const step = (j: any, id: string) => j.steps.find((s: any) => s.id === id)

test('the two book walkthroughs tell the same story and differ only in the venue', () => {
  const shape = (w: Walkthrough) => structuredClone({ keys: { ...w.keys, book: undefined }, steps: w.steps.map(s => ({ id: s.id, do: s.do, key: s.key, args: s.args, expect: s.expect })) })
  const [on, off] = [book('onchain'), book('offchain')]
  expect(on.keys.book).toEqual({ venue: { venue: 'onchain' } })
  expect(off.keys.book).toEqual({ venue: { venue: 'offchain' } })
  const offShape = shape(off)
  step(offShape, 'book').args.venue = 'onchain'
  expect(offShape).toEqual(shape(on))
  expect(on.steps.at(-1)).toMatchObject({ do: 'view', args: { page: 'trade' } })
})
test('deployVenue: venue must be onchain/offchain and match its key', () => {
  const j = bookClone(); step(j, 'book').args.venue = 'offchain'
  expect(has(j, 'venue', /does not match/)).toBe(true)
  const k = bookClone(); step(k, 'book').args.venue = 'moon'
  expect(has(k, 'venue', /onchain or offchain/)).toBe(true)
  const m = bookClone(); step(m, 'book').key = 'ask1'
  expect(has(m, 'key', /must be kind venue/)).toBe(true)
})
test('placeOrder args', () => {
  const j = bookClone(); step(j, 'ask1').args.side = 'ask'
  expect(has(j, 'side', /buy or sell/)).toBe(true)
  const k = bookClone(); delete step(k, 'ask1').args.price
  expect(has(k, 'price', /limit order needs a price/)).toBe(true)
  const m = bookClone(); step(m, 'ask1').args.price = '1.27005'
  expect(has(m, 'price', /at most 4 decimals/)).toBe(true)
  const n = bookClone(); step(n, 'ask1').args.type = 'market'
  expect(has(n, 'price', /market order takes no price/)).toBe(true)
  const o = bookClone(); step(o, 'ask1').args.venue = '$GBP'
  expect(has(o, 'venue', /not a venue/)).toBe(true)
  const q = bookClone(); step(q, 'ask1').args.quote = '$GBP'
  expect(has(q, 'quote', /differ/)).toBe(true)
  const r = bookClone(); step(r, 'ask1').key = 'book'
  expect(has(r, 'key', /must be kind order/)).toBe(true)
})
test('approve before a placeOrder is fine; cancelOrder needs an order', () => {
  expect(validate(bookClone())).toHaveProperty('ok')
  const a = bookClone(); step(a, 'bobOk').args.amount = '2000 $GBP' // a buy gives the quote
  expect(has(a, 'amount', /must be in \$USD/)).toBe(true)
  const j = bookClone()
  j.steps.push({ id: 'cancel', do: 'cancelOrder', title: 'x', text: 'x', args: { from: '$alice', order: '$book' } })
  expect(has(j, 'order', /not a order|not an order/)).toBe(true)
  j.steps.at(-1).args.order = '$ask2'
  expect('ok' in validate(j)).toBe(true)
  j.steps.at(-1).key = 'ask2'
  expect(has(j, 'key', /take no key/)).toBe(true)
})
test('order and trades checks', () => {
  const j = bookClone(); step(j, 'buy').expect[0].status = 'Filled'
  expect(has(j, 'expect', /Unknown order status/)).toBe(true)
  const k = bookClone(); step(k, 'buy').expect[1].filled = '500 $USDX'
  expect(has(k, 'expect', /not a declared key/)).toBe(true)
  const m = bookClone(); step(m, 'buy').expect[4].trades = '$ask1'
  expect(has(m, 'expect', /not a venue/)).toBe(true)
  const n = bookClone(); step(n, 'buy').expect[4].count = -1
  expect(has(n, 'expect', /count must be/)).toBe(true)
  const o = bookClone(); step(o, 'view').args.venue = '$ask1'
  expect(has(o, 'venue', /not a venue/)).toBe(true)
})

const poolW = (): any => structuredClone(bundled.find(w => w.id === 'gbp-usd-pool')!)
test('gbp-usd-pool: Alice issues both, sends Bob 1,000 GBP, and the swap checks Bob\'s USD and k', () => {
  const j = poolW()
  expect(validate(j)).toHaveProperty('ok')
  expect(step(j, 'send')).toMatchObject({ do: 'transfer', args: { from: '$alice', to: '$bob', amount: '1000 $GBP' } })
  expect(step(j, 'swap').expect).toEqual([{ balance: '$bob', has: '1247.42 $USD' }, { pool: '$pool', kGrew: true }])
  expect(j.steps.at(-1)).toMatchObject({ do: 'view', args: { page: 'pool', pool: '$pool' } })
  for (const id of ['aliceGbp', 'aliceUsd', 'bobOk']) expect(step(j, id).text).not.toMatch(/\d/) // approve text names no amounts
})
test('pool step args', () => {
  const a = poolW(); step(a, 'pool').key = 'GBP'
  expect(has(a, 'key', /must be kind pool/)).toBe(true)
  const b = poolW(); step(b, 'pool').args.quote = '$GBP'
  expect(has(b, 'quote', /differ/)).toBe(true)
  const c = poolW(); step(c, 'add').args.pool = '$GBP'
  expect(has(c, 'pool', /not a pool/)).toBe(true)
  const d = poolW(); step(d, 'add').args.base = '100000 $USD'
  expect(has(d, 'base', /the pool's tokens/)).toBe(true)
  const e = poolW(); step(e, 'swap').args.slippageBps = 30
  expect(has(e, 'slippageBps', /10, 50 or 100/)).toBe(true)
  const f = poolW(); step(f, 'swap').args.pay = '1000 $ETH'
  expect(has(f, 'pay', /not a declared key/)).toBe(true)
  const g = poolW(); g.steps.push({ id: 'rm', do: 'removeLiquidity', title: 'x', text: 'x', args: { from: '$alice', pool: '$pool', percent: 50 } })
  expect(validate(g)).toHaveProperty('ok')
  g.steps.at(-1).args.percent = 0
  expect(has(g, 'percent', /1 to 100/)).toBe(true)
  const h = poolW(); step(h, 'add').key = 'pool'
  expect(has(h, 'key', /take no key/)).toBe(true)
})
test('approve before a pool step: spender is the pool, amount in what the step pays', () => {
  const a = poolW(); step(a, 'bobOk').args.amount = '1000 $USD'
  expect(has(a, 'amount', /must be in \$GBP/)).toBe(true)
  const b = poolW(); step(b, 'aliceUsd').args.amount = '1 $GBP'
  expect(validate(b)).toHaveProperty('ok') // either of the add's tokens
})
test('transfer and kGrew checks', () => {
  const a = poolW(); step(a, 'send').args.to = '$GBP'
  expect(has(a, 'to', /not an account/)).toBe(true)
  const b = poolW(); step(b, 'send').key = 'bob'
  expect(has(b, 'key', /take no key/)).toBe(true)
  const c = poolW(); step(c, 'swap').expect[1].pool = '$GBP'
  expect(has(c, 'expect', /not a pool/)).toBe(true)
  const d = poolW(); step(d, 'swap').expect[1].kGrew = false
  expect(has(d, 'expect', /kGrew must be true/)).toBe(true)
  const e = poolW(); step(e, 'view').args.pool = '$GBP'
  expect(has(e, 'pool', /not a pool/)).toBe(true)
})

test('tags: absent is fine; must be 1-8 distinct non-empty strings of at most 24 chars', () => {
  const t = (tags: unknown) => ({ ...clone(), tags })
  expect(errs(clone())).toEqual([])
  expect(errs(t(['a', 'b']))).toEqual([])
  for (const bad of ['swap', [], [''], ['x'.repeat(25)], ['Swap', 'swap'], [1], Array.from({ length: 9 }, (_, i) => `t${i}`)])
    expect(has(t(bad), 'tags', /./)).toBe(true)
  expect(errs(t(['x'.repeat(24)]))).toEqual([])
})
