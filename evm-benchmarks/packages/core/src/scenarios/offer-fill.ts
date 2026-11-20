import {decodeFunctionResult, encodeDeployData, encodeFunctionData, getContractAddress, maxUint256, type Address, type Hex} from 'viem';
import {MintableToken, Swap} from '@evmb/contracts';
import {deriveAccounts} from '../accounts.ts';
import {counted, nonces, settleSetup, signTx} from '../tx.ts';
import {FUND} from './eth-transfer.ts';
import {balanceOf, txCount} from './erc20.ts';
import type {Scenario} from './index.ts';

const abi = MintableToken.abi;
const FILLED = 2; // Swap.Status.Filled

/** n offers (1 A for 1 B) made untimed by `senders` makers; the timed txs are n takes, one per disjoint taker */
export const offerFill = (): Scenario => {
  const next = nonces();
  let swap: Address, tokenA: Address, tokenB: Address;
  const deployer = (seed: string) => deriveAccounts(seed + ':dep', 1)[0]!;
  const makers = (seed: string, s: number) => deriveAccounts(seed, s);
  const takers = (seed: string, n: number) => deriveAccounts(seed + ':t', n);

  return {
    id: 'offer-fill',
    prefund: (p) =>
      Object.fromEntries(
        [deployer(p.seed), ...makers(p.seed, p.senders), ...takers(p.seed, p.n)].map((a) => [a.address, FUND]),
      ),
    async setup(approach, p) {
      const d = deployer(p.seed);
      const dn = next(d.address);
      const addr = (k: number) => getContractAddress({from: d.address, nonce: BigInt(dn + k)});
      [tokenA, tokenB, swap] = [addr(0), addr(1), addr(2)];
      const deploy = (data: Hex) => signTx(d, next(d.address), {data, gas: 3_000_000n});
      await settleSetup(approach, [
        await signTx(d, dn, {data: encodeDeployData({abi, bytecode: MintableToken.bytecode, args: ['A', 'A']}), gas: 3_000_000n}),
        await deploy(encodeDeployData({abi, bytecode: MintableToken.bytecode, args: ['B', 'B']})),
        await deploy(encodeDeployData({abi: Swap.abi, bytecode: Swap.bytecode})),
      ]);

      const approve = encodeFunctionData({abi, functionName: 'approve', args: [swap, maxUint256]});
      const setup: Hex[] = [];
      const fund = async (who: Address, token: Address, amt: number) => {
        const mint = encodeFunctionData({abi, functionName: 'mint', args: [who, BigInt(amt)]});
        setup.push(await signTx(d, next(d.address), {to: token, data: mint, gas: 100_000n}));
      };
      const ms = makers(p.seed, p.senders);
      for (const [j, m] of ms.entries()) {
        await fund(m.address, tokenA, txCount(p, j));
        setup.push(await signTx(m, next(m.address), {to: tokenA, data: approve, gas: 60_000n}));
      }
      for (const t of takers(p.seed, p.n)) {
        await fund(t.address, tokenB, 1);
        setup.push(await signTx(t, next(t.address), {to: tokenB, data: approve, gas: 60_000n}));
      }
      await settleSetup(approach, setup);

      const make = encodeFunctionData({abi: Swap.abi, functionName: 'makeOffer', args: [tokenA, 1n, tokenB, 1n]});
      const offers: Hex[] = [];
      for (const [j, m] of ms.entries())
        for (let k = 0; k < txCount(p, j); k++) offers.push(await signTx(m, next(m.address), {to: swap, data: make, gas: 400_000n}));
      await settleSetup(approach, offers);
    },
    async generate(p, onSigned) {
      const t = takers(p.seed, p.n);
      // all offers are identical, so any taker may take any id; ids are 1..n
      return counted(
        onSigned,
        t.map((a, i) => {
          const data = encodeFunctionData({abi: Swap.abi, functionName: 'take', args: [BigInt(i + 1)]});
          return () => signTx(a, next(a.address), {to: swap, data, gas: 200_000n});
        }),
      );
    },
    async verify(approach, p) {
      const status = async (id: number) => {
        const data = encodeFunctionData({abi: Swap.abi, functionName: 'offers', args: [BigInt(id)]});
        const r = decodeFunctionResult({abi: Swap.abi, functionName: 'offers', data: await approach.call({to: swap, data})});
        return r[5];
      };
      const unfilled: number[] = [];
      const ids = Array.from({length: p.n}, (_, i) => i + 1);
      (await Promise.all(ids.map(status))).forEach((s, i) => s !== FILLED && unfilled.push(i + 1));
      if (unfilled.length) return {ok: false, detail: `offers not filled: ${unfilled.slice(0, 10).join(',')}`};

      const bad: string[] = [];
      const tk = takers(p.seed, p.n);
      const tb = await Promise.all(tk.flatMap((t) => [balanceOf(approach, tokenA, t.address), balanceOf(approach, tokenB, t.address)]));
      tk.forEach((_, i) => (tb[2 * i] !== 1n || tb[2 * i + 1] !== 0n) && bad.push(`taker ${i}`));
      const mk = await Promise.all(makers(p.seed, p.senders).map((m) => balanceOf(approach, tokenB, m.address)));
      mk.forEach((b, j) => b !== BigInt(txCount(p, j)) && bad.push(`maker ${j}`));
      return {ok: bad.length === 0, detail: bad.length ? `wrong balances: ${bad.join(',')}` : `all ${p.n} offers filled, tokens moved exactly`};
    },
  };
};
