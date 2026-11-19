import { describe, test, expect } from 'bun:test'
import { legacyRoute } from '../src/routes'

describe('legacyRoute', () => {
  test('index', () => { expect(legacyRoute('/explorer')).toBe('/chains'); expect(legacyRoute('/explorer/')).toBe('/chains') })
  test('block', () => expect(legacyRoute('/explorer/block/5')).toBe('/chains/block/5'))
  test('block txs', () => expect(legacyRoute('/explorer/block/5/txs')).toBe('/chains/block/5/txs'))
  test('tx and address', () => {
    expect(legacyRoute('/explorer/tx/0xab')).toBe('/chains/tx/0xab')
    expect(legacyRoute('/explorer/address/0xcd')).toBe('/chains/address/0xcd')
  })
  test('other paths give null', () => {
    for (const p of ['/chains', '/accounts', '/explorerx', '/', '']) expect(legacyRoute(p)).toBeNull()
  })
})
