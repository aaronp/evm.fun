import { describe, test, expect } from 'bun:test'
import { crumbsFor } from '../src/state/appBar'

const hash = '0x' + '1234'.padEnd(60, '0') + 'abcd'
const addr = '0x' + 'a'.repeat(40)

describe('crumbsFor', () => {
  test('chains root', () => expect(crumbsFor('/chains')).toEqual([{ label: 'Chains' }]))
  test('block', () =>
    expect(crumbsFor('/chains/block/12', 'demo')).toEqual([{ label: 'Chains', to: '/chains' }, { label: 'demo', to: '/chains' }, { label: 'Block #12' }]))
  test('tx is shortened', () =>
    expect(crumbsFor(`/chains/tx/${hash}`, 'demo')).toEqual([{ label: 'Chains', to: '/chains' }, { label: 'demo', to: '/chains' }, { label: 'Tx 0x1234…abcd' }]))
  test('address', () =>
    expect(crumbsFor(`/chains/address/${addr}`, 'demo')).toEqual([{ label: 'Chains', to: '/chains' }, { label: 'demo', to: '/chains' }, { label: `Address ${addr.slice(0, 6)}…${addr.slice(-4)}` }]))
  test('unknown path gives just the page', () => expect(crumbsFor('/accounts')).toEqual([{ label: 'Accounts' }]))
})
