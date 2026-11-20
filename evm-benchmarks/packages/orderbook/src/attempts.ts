import { getAddress, type Address, type Hex } from 'viem'
import type { Store } from './store'

/** One tx a venue sent (or tried to). `input` is whatever the venue needs to show it again (e.g. the OrderInput as
 * sent, plus `need`: the give amount it checked). `pending` = written before sending, never ended (tab closed). */
export type Attempt = {
  chainId: number; venue: Address; owner: Address; seq: number; time: string; input: any
  status: 'pending' | 'success' | 'reverted' | 'error'; tx?: Hex; block?: bigint; error?: string
}

/** The `attempts` table for one venue deploy, keyed [chainId, venue, owner, seq]; shared by both venues. */
export function journal(store: Store, ctx: { chainId: number; venue: Address }) {
  const venue = getAddress(ctx.venue)
  const key = (seq: number) => `${ctx.chainId}:${venue}:${seq}`
  const counter = `attempts:${ctx.chainId}:${venue}`
  return {
    /** writes the attempt before its tx is sent; returns its seq */
    async begin(input: unknown, owner: Address): Promise<number> {
      // ponytail: read-then-write counter, so two begins racing (two tabs) can share a seq and one row wins; make it an
      // IndexedDB autoincrement or a per-tab prefix if parallel sends ever matter
      const seq = ((await store.get<number>('meta', counter)) ?? 0) + 1
      await store.put('meta', counter, seq)
      const a: Attempt = { chainId: ctx.chainId, venue, owner: getAddress(owner), seq, time: new Date().toISOString(), input, status: 'pending' }
      await store.put('attempts', key(seq), a)
      return seq
    },
    async end(seq: number, out: { tx?: Hex; block?: bigint; status: Attempt['status']; error?: string }) {
      const a = await store.get<Attempt>('attempts', key(seq))
      if (!a) throw new Error(`No attempt ${seq}`)
      await store.put('attempts', key(seq), { ...a, ...out })
    },
    /** the owner's reverted attempts, oldest first */
    async failed(owner: Address): Promise<Attempt[]> {
      const p = [ctx.chainId, venue, getAddress(owner)]
      return (await store.scan<Attempt>('attempts', 'owner', { from: p, to: p })).filter(a => a.status === 'reverted')
    },
  }
}
