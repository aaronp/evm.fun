// bun spike/cf-chain/cost-idle.ts [seconds=120]   (starts/stops local wrangler dev; nothing is deployed)
// Idle WebSocket probe: byte-counting TCP proxy between a subscribed device and local wrangler dev.
const S = import.meta.dir
const { startWrangler, stopWrangler } = await import(`${S}/dev.ts`)
const { Device } = await import(`${S}/src/replica.ts`)
const { privateKeyToAccount } = await import("viem/accounts")
const persist = `${process.env.TMPDIR}/idle-state-${process.pid}`
const w = await startWrangler(S, 8799, persist)
const up = { c2s: 0, s2c: 0 }
Bun.listen({ hostname: '127.0.0.1', port: 8798, socket: {
  async open(s: any) { s.data = { q: [] as Uint8Array[] }; s.data.up = await Bun.connect({ hostname: '127.0.0.1', port: 8799, socket: { data(_u: any, b: Uint8Array) { up.s2c += b.length; s.write(b) }, close() { s.end() } } }); for (const b of s.data.q) s.data.up.write(b) },
  data(s: any, b: Uint8Array) { up.c2s += b.length; s.data.up ? s.data.up.write(b) : s.data.q.push(b) }, close(s: any) { s.data.up?.end() } } })
const A = new Device('http://127.0.0.1:8798', privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'))
const { data } = await A.createChain({ chainId: 777, timestamp: Math.floor(Date.now() / 1000) - 10, alloc: {} })
const ws = await A.socket(data.chainId)
let msgs = 0
await new Promise((ok) => { ws.onopen = ok }); ws.onmessage = () => msgs++
const base = { ...up }
await Bun.sleep(Number(process.argv[2] ?? 120) * 1000)
console.log(JSON.stringify({ idleSeconds: Number(process.argv[2] ?? 120), handshakeBytes: base, idleBytes: { c2s: up.c2s - base.c2s, s2c: up.s2c - base.s2c }, msgs, readyState: ws.readyState }))
ws.close(); await stopWrangler(w, 8799); process.exit(0)
