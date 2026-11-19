import { test, expect } from 'bun:test'
import type { RunResult } from '@evmb/core'
import { tradeoffChips } from '../src/bench/view'

const result = (notes?: string) => ({
  approach: { id: 'x', title: 'X', runsIn: ['browser'], engine: 'webevm@0.9.1+revm', tradeoffs: { evm: true, stateRoot: 'none', log: 'memory', sigVerify: 'parallel-pre', execution: 'serial', notes } },
  params: { n: 1, senders: 1, batch: 1, seed: 's', opts: { block: '500' } },
  env: { engine: 'webevm@0.9.1+revm' },
}) as unknown as RunResult

test('tradeoffChips lists tradeoffs, opts, engine', () => {
  expect(tradeoffChips(result())).toEqual(['evm true', 'stateRoot none', 'log memory', 'sigVerify parallel-pre', 'execution serial', 'block=500', 'webevm@0.9.1+revm'])
})
test('tradeoffChips appends notes last', () => {
  expect(tradeoffChips(result('hi')).at(-1)).toBe('hi')
})
