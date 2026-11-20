import { test, expect } from 'bun:test'
import { encodeDeployData, encodeFunctionData, getAddress, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AssetToken } from '@evmb/contracts'
import { makeOfferCall, readOffers, takeCall, takeReport } from '@evmb/swap'
import { kv } from '../src/store/kv'
import { createChainRegistry } from '../src/chain/registry'
import { contractsRegistry } from '../src/contracts/registry'
import { signAndSend } from '../src/tx/send'
import { deploySwap, swapFor } from '../src/swap/locate'
import type { Account } from '../src/store/accounts'

const key = `0x${'11'.repeat(32)}` as const
const me: Account = { label: 'me', address: privateKeyToAccount(key).address, privateKey: key }
const key2 = `0x${'22'.repeat(32)}` as const
const tester: Account = { label: 'tester', address: privateKeyToAccount(key2).address, privateKey: key2 }

// The page's registries use the shared kv, so the chain registry under test must too.
function registry() {
  const stores = new Map<string, any>()
  return createChainRegistry({
    kv,
    host: (id: string) => ({ persistence: { load: async () => stores.get(id) ?? null, save: async (s: any) => void stores.set(id, structuredClone(s)) } }),
  })
}

test('no Swap record → undefined; deploySwap adds exactly one Swap record that swapFor finds', async () => {
  const h = await registry().create('c', 'plain', [me.address])
  try {
    expect(await swapFor(h)).toBeUndefined()
    let sent = 0
    const addr = await deploySwap(h, me, () => sent++)
    expect(sent).toBe(1)
    const recs = await contractsRegistry.list(h.info.id)
    expect(recs.map(r => r.name)).toEqual(['Swap'])
    expect(recs[0]).toMatchObject({ address: addr, deployer: me.address })
    expect(await swapFor(h)).toBe(addr)
  } finally { await h.dispose() }
})

test('two Swap deploys: the newer wins whatever the address order', async () => {
  const h = await registry().create('c', 'plain', [me.address])
  try {
    const first = await deploySwap(h, me)
    const second = await deploySwap(h, me)
    expect(second.toLowerCase() < first.toLowerCase()).toBe(true) // so the registry's address-keyed list puts the newer one first
    expect(await swapFor(h)).toBe(second)
  } finally { await h.dispose() }
})

test('deploySwap on a benchmark chain throws and records nothing', async () => {
  const reg = registry()
  const h = await reg.create('bench', 'plain', [me.address])
  try {
    reg.addEphemeral(h)
    await expect(deploySwap(h, me)).rejects.toThrow('Benchmark chains keep no contract records')
    expect(await contractsRegistry.list(h.info.id)).toEqual([])
  } finally { await h.dispose() }
})

test('a chain made with createFrom finds the copied Swap record and reads the parent’s offers', async () => {
  const reg = registry()
  const p = await reg.create('parent', 'plain', [me.address])
  try {
    const swap = await deploySwap(p, me)
    const tok = async (sym: string) => {
      const r = await signAndSend(p, me, { data: encodeDeployData({ abi: AssetToken.abi, bytecode: AssetToken.bytecode, args: [sym, sym, 2, 1_000_000n, me.address] }) })
      return getAddress(r.contractAddress!) as Address
    }
    const gbp = await tok('GBP'), usd = await tok('USD')
    await signAndSend(p, me, { to: gbp, data: encodeFunctionData({ abi: AssetToken.abi, functionName: 'approve', args: [swap, 500n] }) })
    expect((await signAndSend(p, me, makeOfferCall(swap, gbp, 500n, usd, 635n))).status).toBe('success')

    const f = await reg.createFrom(await p.approach.snapshot!(), {
      name: 'fork', type: 'plain', contracts: await contractsRegistry.list(p.info.id),
      source: { kind: 'snapshot', snapshotName: 's', fromChainName: 'parent', height: 0 },
    })
    try {
      expect(await swapFor(f)).toBe(swap)
      const offers = await readOffers(f.request, swap)
      expect(offers.map(o => [o.id, o.giveAmt, o.getAmt, o.status])).toEqual([[1n, 500n, 635n, 'open']])
    } finally { await f.dispose() }
  } finally { await p.dispose() }
})

test('a short-allowance take on a playground chain: the report decodes the revert at the parent block and renders it', async () => {
  const h = await registry().create('c', 'plain', [me.address, tester.address])
  try {
    const swap = await deploySwap(h, me)
    const tok = async (sym: string) => {
      const r = await signAndSend(h, me, { data: encodeDeployData({ abi: AssetToken.abi, bytecode: AssetToken.bytecode, args: [sym, sym, 2, 1_000_000n, me.address] }) })
      return getAddress(r.contractAddress!) as Address
    }
    const gbp = await tok('GBP'), usd = await tok('USD')
    const call = (to: Address, functionName: 'approve' | 'transfer', args: [Address, bigint]) =>
      signAndSend(h, me, { to, data: encodeFunctionData({ abi: AssetToken.abi, functionName, args }) })
    await call(gbp, 'approve', [swap, 500n])
    await signAndSend(h, me, makeOfferCall(swap, gbp, 500n, usd, 635n))
    await call(usd, 'transfer', [tester.address, 1_000n]) // enough USD, but no allowance to Swap
    const r = await signAndSend(h, tester, takeCall(swap, 1n))
    expect(r.status).toBe('reverted')

    const report = await takeReport(h.request, r.hash)
    expect(report.reason).toBe('allowance')
    expect(report.reconstructedNow).toBeUndefined()
    expect(report.error).toMatchObject({ name: 'ERC20InsufficientAllowance', args: { spender: getAddress(swap), allowance: 0n, needed: 635n } })

    const { createElement: el } = await import('react')
    const { renderToString } = await import('react-dom/server')
    const { MemoryRouter } = await import('react-router-dom')
    const { ReportView } = await import('../src/pages/SwapReport')
    const assets = [gbp, usd].map((address, i) => ({ address, symbol: i ? 'USD' : 'GBP', decimals: 2 }))
    const html = renderToString(el(MemoryRouter, null, el(ReportView, { report, people: [me, tester], assets: assets as any })))
      .replace(/<!-- -->/g, '')
    for (const t of ['Take #1 failed', 'Reverted · allowance', 'What happened', 'Balance changes', 'On-chain record', 'What to do',
      'Approve Swap to spend at least 6.35 USD from tester, then take the offer again. It is still open at the same price.',
      'Approve 6.35 USD', 'Back to offers', '0 (reverted)', 'revert ERC20InsufficientAllowance', `/chains/tx/${r.hash}`, 'Swap escrow · GBP'])
      expect(html).toContain(t)
  } finally { await h.dispose() }
}, 60_000)
