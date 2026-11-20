import { decodeErrorResult, formatUnits, toHex, type Abi, type Hash, type Hex } from 'viem'
import type { Request } from './venue'

export type Token = { symbol: string; decimals: number }

/** "6,352.50 USD": thousands separated, at least 2 dp (when the token has them), no trailing zeros beyond. */
export const amountText = (raw: bigint, t: Token) => {
  const [i, f = ''] = formatUnits(raw, t.decimals).split('.')
  const frac = f.padEnd(Math.min(2, t.decimals), '0')
  return `${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac && `.${frac}`} ${t.symbol}`
}

/** Replays a reverted tx's call at its parent block (Swap's approach; at `latest` when the node keeps no history) and
 * decodes the revert with `abi`. ponytail: the parent-block replay can't see an earlier tx in the same block, so it can
 * name the wrong reason (or none) — replay the block's earlier txs first if that matters (as Swap's risk, t-68). */
export async function replayError(request: Request, tx: Hash, abi: Abi): Promise<{ error: string; args: unknown[] }> {
  const t = (await request('eth_getTransactionByHash', [tx])) as { from: Hex; to: Hex; input: Hex; gas: Hex; blockNumber: Hex }
  const call = { from: t.from, to: t.to, data: t.input, gas: t.gas }
  const run = async (block: string): Promise<{ data?: Hex; unsupported?: true; failed?: string }> => {
    try {
      await request('eth_call', [call, block])
      return {}
    } catch (e: any) {
      const d = e?.data ?? e?.cause?.data ?? e?.error?.data
      if (typeof d === 'string') return { data: d as Hex }
      const message = String(e?.message ?? e)
      return /historical state not available/i.test(message) ? { unsupported: true } : { failed: message }
    }
  }
  let out = await run(toHex(BigInt(t.blockNumber) - 1n))
  if (out.unsupported) out = await run('latest')
  if (out.data === undefined) return { error: out.failed ? 'ReplayFailed' : 'NotReproduced', args: out.failed ? [out.failed] : [] }
  try {
    const d = decodeErrorResult({ abi, data: out.data }) as { errorName: string; args?: readonly unknown[] }
    return { error: d.errorName, args: [...(d.args ?? [])] }
  } catch {
    return { error: 'Unknown', args: [out.data] }
  }
}

/** The fix for a failed place: `spender` is the venue contract ("OrderBook" / "Settlement"), `give` the token the
 * order spends and `need` how much of it (for a buy: the "at most"), `base`/`amount` the order's size. */
export function fixFor(e: { error: string; args: unknown[] }, c: { spender: string; give: Token; need: bigint; base: Token; amount: bigint }) {
  if (e.error === 'ERC20InsufficientAllowance')
    return `Approve ${c.spender} to spend at least ${amountText(c.need, c.give)}, then place the order again.`
  if (e.error === 'ERC20InsufficientBalance')
    return `Get at least ${amountText(c.need, c.give)} into this wallet, then place the order again.`
  if (e.error === 'BookTooThin')
    return `Only ${amountText(e.args[0] as bigint, c.base)} of ${amountText(c.amount, c.base)} could fill when the order landed: the book changed after it was read. Check the book and place it again.`
  return undefined
}
