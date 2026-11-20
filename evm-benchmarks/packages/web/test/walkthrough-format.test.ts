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
  expect(bundled.length).toBe(2)
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
  const j = clone(); j.steps[3].args.issuer = '$bob'; j.steps.splice(1, 1) // bob step removed -> but key unfilled too
  j.steps.splice(0, 0, j.steps.splice(2, 1)[0]) // chain before alice/bob
  expect(has(j, 'args.prefund', /before its step/)).toBe(true)
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
