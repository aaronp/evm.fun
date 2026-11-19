import { describe, test, expect } from 'bun:test'
import { runInBrowser } from '../src/bench/run'

for (const type of ['plain', 'sequencer'] as const) {
  test(`${type}: eth-transfer verifies, reports signing, leaves a live chain`, async () => {
    const calls: [string, number, number][] = []
    const { result, handle } = await runInBrowser(
      { type, scenario: 'eth-transfer', n: 200, senders: 10, host: {} },
      (p, d, t) => calls.push([p, d, t]),
    )
    expect(result.verified).toBe(true)
    expect(calls).toContainEqual(['signing', 200, 200])
    expect(BigInt((await handle.request('eth_blockNumber')) as string)).toBeGreaterThan(0n)
    await handle.dispose()
  })
}

test('session runs get distinct names/ids and persist across reads', async () => {
  const { addRun, sessionRuns } = await import('../src/bench/session')
  for (let i = 0; i < 2; i++) {
    const { result, handle } = await runInBrowser({ type: 'plain', scenario: 'eth-transfer', n: 10, senders: 2, host: {} })
    addRun(result, handle, 'plain', 'eth-transfer')
  }
  const rs = sessionRuns()
  expect(rs.map(r => r.name)).toEqual(['bench eth-transfer plain #1', 'bench eth-transfer plain #2'])
  expect(new Set(rs.map(r => r.handle.info.id)).size).toBe(2)
  expect(sessionRuns()).toHaveLength(2)
  await Promise.all(rs.map(r => r.handle.dispose()))
})
