import { expect, test } from 'bun:test'
import { CLOSE_REMOVED, LiveHub, headMessage, parseHead } from '../src/live'

const H = { number: 7, hash: '0x' + 'ab'.repeat(32), stateRoot: '0x' + 'cd'.repeat(32) }
const sock = () => {
  const s = { sent: [] as string[], closed: [] as [number, string][], send(d: string) { s.sent.push(d) }, close(c: number, r: string) { s.closed.push([c, r]) } }
  return s
}

test('headMessage → parseHead round-trips', () => {
  expect(headMessage(H)).toBe(`{"type":"head","number":7,"hash":"${H.hash}"}`)
  expect(parseHead(headMessage(H))).toEqual({ number: 7, hash: H.hash })
})

test("parseHead rejects 'pong', junk JSON, a negative number, a non-hex hash", () => {
  expect(parseHead('pong')).toBeNull()
  expect(parseHead('{nope')).toBeNull()
  expect(parseHead(new ArrayBuffer(2))).toBeNull()
  expect(parseHead(`{"type":"head","number":-1,"hash":"${H.hash}"}`)).toBeNull()
  expect(parseHead('{"type":"head","number":1,"hash":"0xzz"}')).toBeNull()
  expect(parseHead(`{"type":"other","number":1,"hash":"${H.hash}"}`)).toBeNull()
})

test('broadcast sends the head to readers', async () => {
  const a = sock()
  await new LiveHub(() => [{ ws: a, tag: 'a' }], async () => true).broadcast(H)
  expect(a.sent).toEqual([headMessage(H)])
  expect(a.closed).toEqual([])
})

test("broadcast closes non-readers with 4003 'removed from chain' and never sends them the head", async () => {
  const a = sock(), b = sock()
  await new LiveHub(() => [{ ws: a, tag: 'a' }, { ws: b, tag: 'b' }], async (t) => t === 'a').broadcast(H)
  expect(a.sent).toEqual([headMessage(H)])
  expect(b.sent).toEqual([])
  expect(b.closed).toEqual([[CLOSE_REMOVED, 'removed from chain']])
  expect(CLOSE_REMOVED).toBe(4003)
})

test('three sockets of one tag → canRead called once', async () => {
  const s = [sock(), sock(), sock()]
  let calls = 0
  await new LiveHub(() => s.map((ws) => ({ ws, tag: 'a' })), async () => (calls++, true)).broadcast(H)
  expect(calls).toBe(1)
  expect(s.map((x) => x.sent.length)).toEqual([1, 1, 1])
})
