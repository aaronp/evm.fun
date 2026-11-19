import {keccak256, type Address, type Hex} from 'viem';
import type {PrivateKeyAccount} from 'viem/accounts';
import type {Approach} from './types.ts';

export async function signTx(
  acct: PrivateKeyAccount,
  nonce: number,
  tx: {to?: Address; data?: Hex; value?: bigint; gas: bigint},
): Promise<Hex> {
  return acct.signTransaction({
    type: 'eip1559',
    chainId: 31337,
    nonce,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    ...tx,
  });
}

/**
 * Run the signing thunks. Without `cb` this is a plain Promise.all. With `cb`, thunks run in
 * chunks of 100: `cb(done)` fires per chunk, then a macrotask yield lets a browser repaint.
 */
export async function counted<T>(cb: ((done: number) => void) | undefined, thunks: (() => Promise<T>)[]): Promise<T[]> {
  if (!cb) return Promise.all(thunks.map((t) => t()));
  const out: T[] = [];
  for (let i = 0; i < thunks.length; i += 100) {
    out.push(...(await Promise.all(thunks.slice(i, i + 100).map((t) => t()))));
    cb(out.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/** Per-address nonce counter. */
export function nonces() {
  const m = new Map<Address, number>();
  return (a: Address) => {
    const n = m.get(a) ?? 0;
    m.set(a, n + 1);
    return n;
  };
}

/** Submit setup txs, wait for them, throw unless all succeeded. */
export async function settleSetup(approach: Approach, raws: Hex[]): Promise<void> {
  await approach.submit(raws);
  const rs = await approach.awaitSettled(raws.map((r) => keccak256(r)));
  const bad = rs.findIndex((r) => r.status !== 'success');
  if (bad >= 0) throw new Error(`setup tx ${bad} ${rs[bad]!.status}: ${rs[bad]!.error ?? ''}`);
}
