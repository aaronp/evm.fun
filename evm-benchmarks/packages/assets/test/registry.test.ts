import { describe, expect, test } from 'bun:test'
import { assetId, createAssetRegistry, memoryStore, nativeAsset, rebase, type Asset } from '../src'

const A = '0xAbCdEf0000000000000000000000000000000001' as const
const B = '0x0000000000000000000000000000000000000002' as const
const tok = (chainId: string, address: `0x${string}`, addedAt = '2026-01-01T00:00:00Z'): Asset => ({
  id: assetId(chainId, address), chainId, kind: 'erc20', address, symbol: 'TKN', name: 'Token',
  decimals: 18, origin: 'launched', mintable: true, addedAt,
})
const fresh = () => createAssetRegistry(memoryStore())

describe('registry', () => {
  test('empty chain lists only native', async () => {
    expect(await fresh().list('c1')).toEqual([nativeAsset('c1')])
  })
  test('add is idempotent, first record kept', async () => {
    const r = fresh()
    await r.add(tok('c1', A))
    await r.add({ ...tok('c1', A), symbol: 'OTHER' })
    const l = await r.list('c1')
    expect(l.length).toBe(2)
    expect(l[0].symbol).toBe('TKN')
  })
  test('same address on two chains is two assets', async () => {
    const r = fresh()
    await r.add(tok('c1', A)); await r.add(tok('c2', A))
    expect(assetId('c1', A)).not.toBe(assetId('c2', A))
    expect((await r.list('c1')).length).toBe(2)
    expect((await r.list('c2')).length).toBe(2)
  })
  test('mixed-case address gives the same id', () => {
    expect(assetId('c1', A)).toBe(assetId('c1', A.toLowerCase() as `0x${string}`))
    expect(assetId('c1')).toBe('c1:native')
  })
  test('list orders by addedAt, native last; get resolves native', async () => {
    const r = fresh()
    await r.add(tok('c1', A, '2026-02-01')); await r.add(tok('c1', B, '2026-01-01'))
    const l = await r.list('c1')
    expect(l.map(a => a.address)).toEqual([B, A, undefined])
    expect(await r.get('c1:native')).toEqual(nativeAsset('c1'))
    expect((await r.get(assetId('c1', A)))?.symbol).toBe('TKN')
  })
  test('replace prunes and ignores native', async () => {
    const r = fresh()
    await r.add(tok('c1', A))
    await r.replace('c1', [tok('c1', B), nativeAsset('c1')])
    const l = await r.list('c1')
    expect(l.map(a => a.address)).toEqual([B, undefined])
  })
  test('remove and removeChain', async () => {
    const r = fresh()
    await r.add(tok('c1', A)); await r.add(tok('c1', B))
    await r.remove(assetId('c1', A))
    expect((await r.list('c1')).length).toBe(2)
    await r.removeChain('c1')
    expect(await r.list('c1')).toEqual([nativeAsset('c1')])
  })
  test('removing native throws', async () => {
    await expect(fresh().remove('c1:native')).rejects.toThrow("The native asset can't be removed")
  })
  test('rebase rewrites id and chainId', () => {
    const t = rebase(tok('c1', A), 'c9')
    expect(t.chainId).toBe('c9')
    expect(t.id).toBe(assetId('c9', A))
    expect(rebase(nativeAsset('c1'), 'c9').id).toBe('c9:native')
  })
})
