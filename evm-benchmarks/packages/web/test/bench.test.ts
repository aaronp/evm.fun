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
