import {encodeDeployData, encodeFunctionData, getContractAddress, maxUint256, type Address, type Hex} from 'viem';
import {AtomicSwap, MintableToken} from '@evmb/contracts';
import {deriveAccounts} from '../accounts.ts';
import {counted, nonces, settleSetup, signTx} from '../tx.ts';
import {FUND} from './eth-transfer.ts';
import {balanceOf, txCount} from './erc20.ts';
import type {Scenario} from './index.ts';

const abi = MintableToken.abi;

export const atomicSwap = (): Scenario => {
  const next = nonces();
  let swap: Address, tokenA: Address, tokenB: Address;
  const deployer = (seed: string) => deriveAccounts(seed + ':dep', 1)[0]!;
  const aParties = (seed: string, s: number) => deriveAccounts(seed, s);
  const bParties = (seed: string, s: number) => deriveAccounts(seed + ':b', s);

  return {
    id: 'atomic-swap',
    prefund: (p) =>
      Object.fromEntries(
        [deployer(p.seed), ...aParties(p.seed, p.senders), ...bParties(p.seed, p.senders)].map((a) => [a.address, FUND]),
      ),
    async setup(approach, p) {
      const d = deployer(p.seed);
      const dn = next(d.address);
      const addr = (k: number) => getContractAddress({from: d.address, nonce: BigInt(dn + k)});
      [tokenA, tokenB, swap] = [addr(0), addr(1), addr(2)];
      const deploy = (data: Hex) => signTx(d, next(d.address), {data, gas: 3_000_000n});
      const raws: Hex[] = [
        await signTx(d, dn, {data: encodeDeployData({abi, bytecode: MintableToken.bytecode, args: ['A', 'A']}), gas: 3_000_000n}),
        await deploy(encodeDeployData({abi, bytecode: MintableToken.bytecode, args: ['B', 'B']})),
        await deploy(encodeDeployData({abi: AtomicSwap.abi, bytecode: AtomicSwap.bytecode})),
      ];
      await settleSetup(approach, raws);

      const setup: Hex[] = [];
      for (const [parties, token] of [[aParties(p.seed, p.senders), tokenA], [bParties(p.seed, p.senders), tokenB]] as const) {
        for (const s of parties) {
          const mint = encodeFunctionData({abi, functionName: 'mint', args: [s.address, BigInt(p.n)]});
          setup.push(await signTx(d, next(d.address), {to: token, data: mint, gas: 100_000n}));
          const approve = encodeFunctionData({abi, functionName: 'approve', args: [swap, maxUint256]});
          setup.push(await signTx(s, next(s.address), {to: token, data: approve, gas: 60_000n}));
        }
      }
      await settleSetup(approach, setup);
    },
    async generate(p, onSigned) {
      const a = aParties(p.seed, p.senders);
      const b = bParties(p.seed, p.senders);
      return counted(
        onSigned,
        Array.from({length: p.n}, (_, i) => {
          const j = i % p.senders;
          const data = encodeFunctionData({
            abi: AtomicSwap.abi,
            functionName: 'swap',
            args: [tokenA, 1n, b[j]!.address, tokenB, 1n],
          });
          return () => signTx(a[j]!, next(a[j]!.address), {to: swap, data, gas: 200_000n});
        }),
      );
    },
    async verify(approach, p) {
      const bad: number[] = [];
      const a = aParties(p.seed, p.senders), b = bParties(p.seed, p.senders);
      for (let j = 0; j < p.senders; j++) {
        const c = BigInt(txCount(p, j)), n = BigInt(p.n);
        const got = await Promise.all([
          balanceOf(approach, tokenA, a[j]!.address), balanceOf(approach, tokenB, a[j]!.address),
          balanceOf(approach, tokenA, b[j]!.address), balanceOf(approach, tokenB, b[j]!.address),
        ]);
        const want = [n - c, c, c, n - c];
        if (got.some((g, k) => g !== want[k])) bad.push(j);
      }
      return {ok: bad.length === 0, detail: bad.length ? `pairs with wrong balances: ${bad.join(',')}` : `all ${p.senders} pairs exact`};
    },
  };
};
