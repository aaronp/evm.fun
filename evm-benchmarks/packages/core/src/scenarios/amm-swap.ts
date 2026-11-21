import {decodeFunctionResult, encodeDeployData, encodeFunctionData, getContractAddress, maxUint256, type Address, type Hex} from 'viem';
import {MintableToken, Pool} from '@evmb/contracts';
import {deriveAccounts} from '../accounts.ts';
import {counted, nonces, settleSetup, signTx} from '../tx.ts';
import {FUND} from './eth-transfer.ts';
import {balanceOf, txCount} from './erc20.ts';
import type {Scenario} from './index.ts';

const abi = MintableToken.abi;
const U = 10n ** 18n; // one whole unit; each swap pays 1 unit in
const SEED = 1_000_000n * U;

/** a large seed pool; N swaps of 1 unit from disjoint traders, even index base in, odd quote in, minOut 0 */
export const ammSwap = (): Scenario => {
  const next = nonces();
  let pool: Address, base: Address, quote: Address, k0 = 0n;
  const deployer = (seed: string) => deriveAccounts(seed + ':dep', 1)[0]!;
  const traders = (seed: string, s: number) => deriveAccounts(seed, s);
  /** how many base-in (even index) and quote-in swaps trader j makes */
  const dirs = (p: {n: number; senders: number}, j: number) => {
    let b = 0, q = 0;
    for (let i = j; i < p.n; i += p.senders) i % 2 === 0 ? b++ : q++;
    return {b: BigInt(b), q: BigInt(q)};
  };
  const reserves = async (approach: Parameters<Scenario['verify']>[0]) => {
    const data = encodeFunctionData({abi: Pool.abi, functionName: 'reserves'});
    return decodeFunctionResult({abi: Pool.abi, functionName: 'reserves', data: await approach.call({to: pool, data})}) as readonly [bigint, bigint];
  };

  return {
    id: 'amm-swap',
    prefund: (p) => Object.fromEntries([deployer(p.seed), ...traders(p.seed, p.senders)].map((a) => [a.address, FUND])),
    async setup(approach, p) {
      const d = deployer(p.seed);
      const dn = next(d.address);
      const addr = (k: number) => getContractAddress({from: d.address, nonce: BigInt(dn + k)});
      [base, quote, pool] = [addr(0), addr(1), addr(2)];
      const deploy = (data: Hex) => signTx(d, next(d.address), {data, gas: 4_000_000n});
      await settleSetup(approach, [
        await signTx(d, dn, {data: encodeDeployData({abi, bytecode: MintableToken.bytecode, args: ['Base', 'BASE']}), gas: 3_000_000n}),
        await deploy(encodeDeployData({abi, bytecode: MintableToken.bytecode, args: ['Quote', 'QUOTE']})),
        await deploy(encodeDeployData({abi: Pool.abi, bytecode: Pool.bytecode, args: [base, quote]})),
      ]);

      const approve = encodeFunctionData({abi, functionName: 'approve', args: [pool, maxUint256]});
      const setup: Hex[] = [];
      const call = async (a: typeof d, to: Address, data: Hex, gas = 100_000n) => setup.push(await signTx(a, next(a.address), {to, data, gas}));
      const mint = (who: Address, amt: bigint) => encodeFunctionData({abi, functionName: 'mint', args: [who, amt]});
      for (const t of [base, quote]) {
        await call(d, t, mint(d.address, SEED));
        await call(d, t, approve, 60_000n);
      }
      for (const [j, a] of traders(p.seed, p.senders).entries()) {
        const amt = BigInt(txCount(p, j)) * U;
        for (const t of [base, quote]) {
          await call(d, t, mint(a.address, amt));
          await call(a, t, approve, 60_000n);
        }
      }
      await call(d, pool, encodeFunctionData({abi: Pool.abi, functionName: 'addLiquidity', args: [SEED, SEED, 0n]}), 400_000n);
      await settleSetup(approach, setup);
      const [rb, rq] = await reserves(approach);
      k0 = rb * rq;
    },
    async generate(p, onSigned) {
      const t = traders(p.seed, p.senders);
      return counted(
        onSigned,
        Array.from({length: p.n}, (_, i) => {
          const a = t[i % p.senders]!;
          const data = encodeFunctionData({abi: Pool.abi, functionName: 'swap', args: [i % 2 === 0 ? base : quote, U, 0n]});
          return () => signTx(a, next(a.address), {to: pool, data, gas: 250_000n});
        }),
      );
    },
    async verify(approach, p) {
      const [rb, rq] = await reserves(approach);
      const d = deployer(p.seed).address;
      const [db, dq] = await Promise.all([balanceOf(approach, base, d), balanceOf(approach, quote, d)]);
      let sb = rb + db, sq = rq + dq, minted = {b: SEED, q: SEED};
      const bad: string[] = [];
      for (const [j, a] of traders(p.seed, p.senders).entries()) {
        const [tb, tq] = await Promise.all([balanceOf(approach, base, a.address), balanceOf(approach, quote, a.address)]);
        const {b, q} = dirs(p, j);
        const fund = BigInt(txCount(p, j)) * U;
        sb += tb;
        sq += tq;
        minted = {b: minted.b + fund, q: minted.q + fund};
        // output = balance minus what is left after paying; each 1-unit swap yields ~0.997 near price 1, so a
        // missing swap shows as a shortfall. ponytail: 90% floor assumes the pool price stays near 1 (n << SEED)
        if (q > 0n && tb - (fund - b * U) <= (q * U * 9n) / 10n) bad.push(`trader ${j} base output short`);
        if (b > 0n && tq - (fund - q * U) <= (b * U * 9n) / 10n) bad.push(`trader ${j} quote output short`);
      }
      const k = rb * rq;
      if (sb !== minted.b || sq !== minted.q) bad.push('token conservation broken');
      if (k < k0) bad.push('k shrank');
      return {ok: bad.length === 0, detail: bad.length ? bad.slice(0, 5).join('; ') : `reserves ${rb}/${rq}, k ${k} >= ${k0}, ${p.n} swaps, tokens conserved`};
    },
  };
};
