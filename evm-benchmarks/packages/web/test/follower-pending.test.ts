import { expect, test } from 'bun:test'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { PendingTx } from '@evmb/node/src/followerStore'
import { pendingSummary } from '../src/cloud/followerChain'
import { PendingPanel } from '../src/components/cloud/PendingPanel'

const log = { address: `0x${'22'.repeat(20)}`, topics: [], data: '0x' } as const
const tx = (seq: number, o: Partial<PendingTx> = {}): PendingTx => ({
  hash: `0x${String(seq).repeat(64)}`, raw: '0x00', from: `0x${'11'.repeat(20)}`, nonce: seq, seq, status: 'pending', first: { status: 'success', logs: [log] }, ...o,
})
const html = (txs: PendingTx[]) => renderToString(h(MemoryRouter, null, h(PendingPanel, {
  chain: { info: { id: 'c', name: 'Shop', type: 'follower', createdAt: '', follows: { nodeUrl: 'https://n', chainId: 'x', account: log.address } }, approach: { pendingTxs: () => txs } } as any,
}))).replaceAll('<!-- -->', '')

test('app-bar summary counts pending and undismissed conflicted', () => {
  expect(pendingSummary([])).toEqual({ pending: 0, conflicted: 0 })
  expect(pendingSummary([tx(1), tx(2), tx(3, { status: 'conflicted' }), tx(4, { status: 'confirmed' }), tx(5, { status: 'refused' })])).toEqual({ pending: 2, conflicted: 1 })
})

test('the Pending panel shows each record: status, hash, sender, outcome; conflicted both sides and what it depends on; refused the reason', () => {
  const out = html([
    tx(1),
    tx(2, { status: 'confirmed', block: 7 }),
    tx(3, { status: 'conflicted', block: 8, cloud: { status: 'reverted', logs: [] } }),
    tx(4, { status: 'conflicted', block: 8, cloud: { status: 'success', logs: [] }, dependsOn: tx(3).hash }),
    tx(5, { status: 'refused', reason: 'nonce too low' }),
  ])
  expect(out).toContain('0x1111…1111')
  expect(out).toContain('Here: success, 1 log · Cloud: reverted, 0 logs')
  expect(out).toContain('After 0x3333…3333 conflicted')
  expect(out).toContain('nonce too low')
  expect(out).toContain('Block #7')
  for (const s of ['pending', 'confirmed', 'conflicted', 'refused']) expect(out).toContain(`>${s}</span>`)
  expect(out.match(/>Dismiss</g)).toHaveLength(4) // the settled ones
  expect(out).toContain('Dismiss settled')
})

test('an empty Pending panel says so', () => {
  const out = html([])
  expect(out).toContain('Nothing waiting.')
  expect(out).not.toContain('Dismiss')
})
