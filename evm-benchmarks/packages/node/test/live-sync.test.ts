import { describe, expect, test } from 'bun:test'
import { CLOSE_REMOVED, headMessage, liveSync, type LiveState } from '../src/live'
import { FollowerGone } from '../src/follower'

const hash = ('0x' + '11'.repeat(32)) as `0x${string}`
const head = (n: number) => headMessage({ number: n, hash } as never)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

class FakeWS {
  static all: FakeWS[] = []
  sent: string[] = []; closed?: number; urls: string
  #l: Record<string, ((e: any) => void)[]> = {}
  constructor(public url: string) { this.urls = url; FakeWS.all.push(this) }
  addEventListener(t: string, f: (e: any) => void) { (this.#l[t] ??= []).push(f) }
  send(d: string) { this.sent.push(d) }
  close(code = 1000) { this.closed ??= code }
  emit(t: string, e: any = {}) { for (const f of this.#l[t] ?? []) f(e) }
  open() { this.emit('open') }
  msg(data: unknown) { this.emit('message', { data }) }
  drop(code = 1006) { this.emit('close', { code }) }
}

function setup(o: Parameters<typeof liveSync>[2] = {}, sync: () => Promise<unknown> = async () => {}) {
  FakeWS.all = []
  const f = { head: { number: 5 }, syncs: 0, sync() { this.syncs++; return sync() } }
  const states: LiveState[] = []
  let urls = 0
  const stop = liveSync(f, async () => `ws://x/${++urls}`, { WebSocket: FakeWS as never, minBackoffMs: 20, maxBackoffMs: 80, pingMs: 1e6, pongMs: 1e6, random: () => 0.5, onState: (s) => states.push(s), ...o })
  return { f, states, stop, ws: () => FakeWS.all.at(-1)! }
}

describe('liveSync', () => {
  test('open → sync once, state live', async () => {
    const t = setup(); await wait(5); t.ws().open()
    expect(t.f.syncs).toBe(1); expect(t.states).toEqual(['connecting', 'live']); t.stop()
  })
  test('only a newer head syncs; pong and junk do not', async () => {
    const t = setup(); await wait(5); t.ws().open()
    for (const m of [head(5), head(3), 'pong', 'junk', 7]) t.ws().msg(m)
    expect(t.f.syncs).toBe(1)
    t.ws().msg(head(6)); expect(t.f.syncs).toBe(2); t.stop()
  })
  test('close 1006 → down, reconnects with a fresh url, then syncs on open', async () => {
    const t = setup(); await wait(5); t.ws().open(); t.ws().drop()
    expect(t.states.at(-1)).toBe('down'); expect(t.f.syncs).toBe(1)
    await wait(50)
    expect(FakeWS.all.map((w) => w.url)).toEqual(['ws://x/1', 'ws://x/2'])
    t.ws().open(); expect(t.f.syncs).toBe(2); t.stop()
  })
  test('backoff doubles to max and resets after an open', async () => {
    const t = setup(); const at: number[] = []
    const t0 = Date.now()
    for (let i = 0; i < 5; i++) { while (FakeWS.all.length < i + 1) await wait(2); at.push(Date.now() - t0); t.ws().drop() }
    const gaps = at.slice(1).map((v, i) => v - at[i]!)
    expect(gaps[0]!).toBeGreaterThanOrEqual(18); expect(gaps[1]!).toBeGreaterThanOrEqual(38); expect(gaps[2]!).toBeGreaterThanOrEqual(75); expect(gaps[3]!).toBeLessThan(140)
    while (FakeWS.all.length < 6) await wait(2)
    t.ws().open(); t.ws().drop()
    const n = FakeWS.all.length; await wait(35)
    expect(FakeWS.all.length).toBe(n + 1); t.stop()
  })
  test('a failed connect runs one sync', async () => {
    const t = setup(); await wait(5); t.ws().drop()
    expect(t.f.syncs).toBe(1); t.stop()
  })
  test('close 4003 → one sync that ends in removed: removed, no reconnect', async () => {
    let n = 0
    const t = setup({}, async () => { if (++n === 2) throw Object.assign(new Error('x'), { name: 'FollowerRemoved' }) }); await wait(5); t.ws().open(); t.ws().drop(CLOSE_REMOVED)
    expect(t.f.syncs).toBe(2); expect(t.states.at(-1)).toBe('removed')
    await wait(60); expect(FakeWS.all.length).toBe(1)
  })
  test('a 4003 whose sync does not end in removed reconnects with backoff', async () => {
    const t = setup(); await wait(5); t.ws().open(); t.ws().drop(CLOSE_REMOVED)
    await wait(60); expect(FakeWS.all.length).toBeGreaterThan(1); expect(t.states).toContain('down'); t.stop()
  })
  test('a pong keeps the socket alive across several ping intervals', async () => {
    const t = setup({ pingMs: 10, pongMs: 15 }); await wait(5); t.ws().open()
    const ws = t.ws()
    for (let i = 0; i < 5; i++) { await wait(10); ws.msg('pong') }
    expect(ws.sent.length).toBeGreaterThanOrEqual(4); expect(ws.closed).toBeUndefined(); expect(FakeWS.all.length).toBe(1); t.stop()
  })
  test('reconnect waits backoff * (0.5 + random)', async () => {
    const t = setup({ minBackoffMs: 100, maxBackoffMs: 100, random: () => 0 }); await wait(5); t.ws().drop()
    await wait(30); expect(FakeWS.all.length).toBe(1)
    await wait(40); expect(FakeWS.all.length).toBe(2); t.stop() // 50 ms (0.5 * 100), not 100
  })
  test('no pong within pongMs → closed, reconnected, then sync', async () => {
    const t = setup({ pingMs: 10, pongMs: 15 }); await wait(5); t.ws().open()
    await wait(20); expect(t.ws().sent).toEqual(['ping'])
    await wait(40)
    expect(FakeWS.all[0]!.closed).toBeDefined(); expect(FakeWS.all.length).toBeGreaterThan(1)
    t.ws().open(); expect(t.f.syncs).toBe(2); t.stop()
  })
  test('stop() closes the socket and nothing reconnects', async () => {
    const t = setup(); await wait(5); t.ws().open(); t.stop(); t.ws().drop()
    expect(t.ws().closed).toBeDefined(); await wait(60); expect(FakeWS.all.length).toBe(1)
  })
  test('sync throwing FollowerGone stops the loop', async () => {
    const t = setup({}, async () => { throw new FollowerGone() }); await wait(5); t.ws().open(); await wait(5)
    t.ws().drop(); await wait(60)
    expect(FakeWS.all.length).toBe(1)
  })
  test('other sync errors are swallowed', async () => {
    const t = setup({}, async () => { throw new Error('offline') }); await wait(5); t.ws().open(); await wait(5)
    t.ws().drop(); await wait(40); expect(FakeWS.all.length).toBe(2); t.stop()
  })
  test('a head arriving during a running sync is not lost', async () => {
    FakeWS.all = []
    let release!: () => void, run: Promise<void> | undefined
    const pending = new Promise<void>((r) => (release = r))
    // like Follower.sync(): a call while a pass runs joins it (the pass was planned at head 4 and ends at 6)
    const f = { head: { number: 4 }, sync: () => (run ??= (async () => { await pending; f.head.number = f.head.number === 4 ? 6 : 7 })().finally(() => (run = undefined))) }
    const stop = liveSync(f, async () => 'ws://x', { WebSocket: FakeWS as never, pingMs: 1e6, pongMs: 1e6 })
    await wait(5); FakeWS.all[0]!.open(); FakeWS.all[0]!.msg(head(7)) // newer than 4: joins the running pass
    release(); await wait(10)
    expect(f.head.number).toBe(7); stop()
  })
})
