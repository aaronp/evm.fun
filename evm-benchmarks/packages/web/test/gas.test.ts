import { test, expect, describe } from 'bun:test'
import { parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { balances, nativeAsset } from '@evmb/assets'
import { gasShortfall, signAndSend } from '../src/tx/send'
import { gasFix, linkedSend } from '../src/fix'
import { fixReturned } from '../src/walkthrough/wizard'
import { createKv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'

const key = (b: string) => `0x${b.repeat(32)}` as const
const acct = (label: string, b: string) => ({ label, address: privateKeyToAccount(key(b)).address, privateKey: key(b) })
const alice = acct('alice', '11'), bob = acct('bob', '22'), carol = acct('carol', '33') // carol: no ETH
const people = [alice, bob, carol]
const q = (href: string) => new URLSearchParams(href.split('?')[1])

function registry() {
  const stores = new Map<string, any>()
  return createChainRegistry({
    kv: createKv(),
    host: id => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
    purge: async id => void stores.delete(id),
  })
}

describe.each(['plain', 'sequencer'] as const)('a 0-ETH sender on a real %s chain', type => {
  test('gets a gas shortfall; the fix requests ETH from the richest other account; the round trip pays for the tx', async () => {
    const h = await registry().create('c', type, [alice.address, bob.address])
    await signAndSend(h, alice, { to: bob.address, value: parseEther('100') }) // bob now holds the most
    // refused before sending (a sequencer chain's executor would stop for good on it): a typed gas shortfall
    const tx = { to: alice.address, value: 1n }
    const got = await signAndSend(h, carol, tx).then(() => undefined, e => e)
    expect(got).toBeInstanceOf(Error)
    const g = gasShortfall(got)!
    expect(g.address).toBe(carol.address)
    expect(g.have).toBe(0n)
    expect(g.need! > 0n).toBe(true)
    const native = nativeAsset(h.info.id)
    const bals = await balances(h.request, native, people.map(p => p.address))
    const back = `/transact?chain=${h.info.id}&as=carol`
    const fix = gasFix({ chainId: h.info.id, shortfall: g, balances: bals, back, accounts: people })!
    expect(fix.label).toBe('Request 0.01 ETH from bob') // 0.006 ETH short (3M gas fallback × 2 gwei) → 0.01
    const p = q(fix.href)
    expect(Object.fromEntries(p)).toEqual({ chain: h.info.id, as: 'bob', asset: native.id, send: carol.address, amount: '0.01', back })
    // the Assets page opens Send as bob, prefilled, and returns to `back` as carol
    const l = linkedSend(p, people)!
    expect(l).toMatchObject({ from: bob, asset: native.id, to: carol.address, amount: '0.01', back })
    expect(q(l.back!).get('as')).toBe('carol')
    expect((await signAndSend(h, l.from, { to: l.to as `0x${string}`, value: parseEther(l.amount) })).status).toBe('success')
    expect((await signAndSend(h, carol, tx)).status).toBe('success')
    await h.dispose()
  })
})

describe('gasFix', () => {
  const shortfall = { address: carol.address, need: 6_000_000_000_000_001n, have: 0n }
  const base = { chainId: 'c1', shortfall, back: '/swap?chain=c1&as=carol', accounts: people }
  const bals = (a: bigint, b: bigint) => new Map([[alice.address, a], [bob.address, b], [carol.address, 0n]])
  test('no other account holds more than the amount: no fix', () => {
    expect(gasFix({ ...base, balances: bals(0n, 0n) })).toBeUndefined()
    expect(gasFix({ ...base, balances: bals(parseEther('0.01'), 0n) })).toBeUndefined()
    expect(gasFix({ ...base, balances: bals(parseEther('0.01') + 1n, 0n) })!.label).toBe('Request 0.01 ETH from alice')
  })
  test('never from the sender itself, however rich', () => {
    expect(gasFix({ ...base, shortfall: { ...shortfall, address: alice.address }, balances: bals(parseEther('9'), 0n) })).toBeUndefined()
  })
  test('rounded up to 0.01 ETH; unknown shortfall: 1 ETH', () => {
    expect(gasFix({ ...base, shortfall: { ...shortfall, need: parseEther('0.02') + 1n }, balances: bals(parseEther('5'), 0n) })!.label).toBe('Request 0.03 ETH from alice')
    expect(gasFix({ ...base, shortfall: { ...shortfall, need: parseEther('0.02') }, balances: bals(parseEther('5'), 0n) })!.label).toBe('Request 0.02 ETH from alice')
    expect(gasFix({ ...base, shortfall: { address: carol.address }, balances: bals(parseEther('5'), 0n) })!.label).toBe('Request 1 ETH from alice')
    expect(gasFix({ ...base, shortfall: { address: carol.address }, balances: bals(parseEther('1'), 0n) })).toBeUndefined()
  })
})

test('gasShortfall: reads the message wherever it ended up; other errors are not one', () => {
  const m = 'insufficient funds for gas * price + value: address 0x5cbdd86a2fa8dc4bddd8a8f69dba48572eec07fb have 5 want 6000000000000001. The sender must…'
  const want = { address: '0x5CbDd86a2FA8Dc4bDdd8a8f69dBa48572EeC07FB' as const, have: 5n, need: 6000000000000001n }
  expect(gasShortfall(`Transfer rejected: ${m}`)).toEqual(want)
  expect(gasShortfall(new Error(m))).toEqual(want)
  expect(gasShortfall({ status: 'rejected', error: m })).toEqual(want)
  expect(gasShortfall('Not enough GBP — you have 0.00.')).toBeUndefined()
  expect(gasShortfall(undefined)).toBeUndefined()
})

test('fixReturned: a fix was opened, then the location left it (the Send landed and came back)', () => {
  const href = '/assets?chain=c1&as=bob&asset=c1%3Anative&send=0x1&amount=0.01&back=%2Fswap'
  expect(fixReturned(false, '/swap?chain=c1&as=carol', href)).toBe(false) // not opened yet
  expect(fixReturned(true, href, href)).toBe(false) // still on it
  expect(fixReturned(true, '/swap?chain=c1&as=carol', href)).toBe(true)
})
