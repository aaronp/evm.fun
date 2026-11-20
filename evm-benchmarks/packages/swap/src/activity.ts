import { decodeEventLog, encodeEventTopics, getAddress, pad, toFunctionSelector, toHex, type Address, type Hash, type Hex } from 'viem'
import type { Request } from '@evmb/assets'
import { swapAbi } from './abi'
import { erc20Events, logAt, takeReport, type RpcLog, type TakeReport } from './report'

export type ActivityItem = {
  kind: 'offered' | 'taken' | 'cancelled' | 'reverted' | 'approved'
  id?: bigint; actor: Address; tx: Hash; block: bigint; txIndex: number; token?: Address; amount?: bigint; reason?: TakeReport['reason']
}

const TAKE = toFunctionSelector('take(uint256)')

/** Swap activity, newest first: offers made/taken/cancelled, reverted takes and approvals of `pairTokens` to the Swap. */
export async function activity(request: Request, swap: Address, pairTokens: Address[]): Promise<ActivityItem[]> {
  const logs = (q: object) => request('eth_getLogs', [{ fromBlock: '0x0', toBlock: 'latest', ...q }]) as Promise<RpcLog[]>
  const approval = encodeEventTopics({ abi: erc20Events, eventName: 'Approval' })[0]
  const [swapLogs, approvals, head] = await Promise.all([
    logs({ address: swap }),
    pairTokens.length ? logs({ address: pairTokens, topics: [approval, null, pad(swap.toLowerCase() as Hex)] }) : [],
    request('eth_blockNumber', []) as Promise<Hex>,
  ])
  const items: (ActivityItem & { logIndex: number })[] = []
  const item = (l: RpcLog, x: Omit<ActivityItem, 'tx' | 'block' | 'txIndex'>) =>
    items.push({ ...x, tx: l.transactionHash, ...logAt(l), logIndex: Number(l.logIndex) })

  const makers = new Map<bigint, Address>()
  for (const l of swapLogs) {
    const e = decodeEventLog({ abi: swapAbi, ...l })
    if (e.eventName === 'OfferMade') {
      makers.set(e.args.id, getAddress(e.args.maker))
      item(l, { kind: 'offered', id: e.args.id, actor: getAddress(e.args.maker), token: getAddress(e.args.giveToken), amount: e.args.giveAmt })
    } else if (e.eventName === 'OfferTaken') item(l, { kind: 'taken', id: e.args.id, actor: getAddress(e.args.taker) })
    else item(l, { kind: 'cancelled', id: e.args.id, actor: makers.get(e.args.id)! }) // only the maker can cancel
  }
  for (const l of approvals) {
    const e = decodeEventLog({ abi: erc20Events, eventName: 'Approval', ...l })
    item(l, { kind: 'approved', actor: getAddress(e.args.owner), token: getAddress(l.address), amount: e.args.value })
  }

  // Reverted takes leave no logs: scan every block for take() txs to the Swap that failed.
  // ponytail: full block scan per call; an index or a bounded window when chains get long (risk, backlog t-69)
  const blocks = await Promise.all(Array.from({ length: Number(BigInt(head)) + 1 }, (_, b) =>
    request('eth_getBlockByNumber', [toHex(b), true]) as Promise<{ transactions: { hash: Hash; to: Address | null; input: Hex }[] } | null>))
  const takes = blocks.flatMap(b => b?.transactions ?? []).filter(t => t.to?.toLowerCase() === swap.toLowerCase() && t.input.startsWith(TAKE))
  await Promise.all(takes.map(async t => {
    const rc = (await request('eth_getTransactionReceipt', [t.hash])) as { status: Hex } | null
    if (rc?.status !== '0x0') return
    const r = await takeReport(request, t.hash)
    items.push({ kind: 'reverted', id: r.offer.id, actor: r.taker, tx: t.hash, block: r.block, txIndex: r.txIndex, reason: r.reason, logIndex: 0 })
  }))

  const key = (i: { block: bigint; txIndex: number; logIndex: number }) => [i.block, BigInt(i.txIndex), BigInt(i.logIndex)]
  items.sort((a, b) => {
    const [x, y] = [key(a), key(b)]
    for (let k = 0; k < 3; k++) if (x[k] !== y[k]) return x[k]! > y[k]! ? -1 : 1
    return 0
  })
  return items.map(({ logIndex, ...i }) => i)
}
