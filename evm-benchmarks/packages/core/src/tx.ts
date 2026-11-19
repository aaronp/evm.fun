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

/** Wrap signing promises so `cb(done)` fires as each one resolves (no-op without cb). */
export function counted<T>(cb: ((done: number) => void) | undefined, ps: Promise<T>[]): Promise<T[]> {
  let done = 0;
  return Promise.all(cb ? ps.map((p) => p.then((v) => (cb(++done), v))) : ps);
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
