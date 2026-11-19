import {decodeFunctionResult, encodeDeployData, encodeFunctionData, getContractAddress, type Address, type Hex} from 'viem';
import {MintableToken} from '@evmb/contracts';
import type {Approach} from '../types.ts';
import {deriveAccounts} from '../accounts.ts';
import {nonces, settleSetup, signTx} from '../tx.ts';
import {FUND} from './eth-transfer.ts';
import type {Scenario, ScenarioParams} from './index.ts';

const abi = MintableToken.abi;

export async function balanceOf(a: Approach, token: Address, who: Address): Promise<bigint> {
  const data = encodeFunctionData({abi, functionName: 'balanceOf', args: [who]});
  return decodeFunctionResult({abi, functionName: 'balanceOf', data: await a.call({to: token, data})}) as bigint;
}

export async function totalSupply(a: Approach, token: Address): Promise<bigint> {
  const data = encodeFunctionData({abi, functionName: 'totalSupply'});
  return decodeFunctionResult({abi, functionName: 'totalSupply', data: await a.call({to: token, data})}) as bigint;
}

type Kind = 'disjoint' | 'hot' | 'mint';

function make(kind: Kind): () => Scenario {
  return () => {
    const next = nonces();
    let token: Address;
    const deployer = (p: ScenarioParams) => deriveAccounts(p.seed + ':dep', 1)[0]!;
    const receivers = (p: ScenarioParams) => deriveAccounts(p.seed + ':rx', kind === 'hot' ? 4 : p.n);
    const rxIndex = (i: number) => (kind === 'hot' ? i % 4 : i);

    return {
      id: `erc20-${kind}` as Scenario['id'],
      prefund(p) {
        const accts = [deployer(p), ...(kind === 'mint' ? [] : deriveAccounts(p.seed, p.senders))];
        return Object.fromEntries(accts.map((a) => [a.address, FUND]));
      },
      async setup(approach, p) {
        const d = deployer(p);
        const dn = next(d.address);
        token = getContractAddress({from: d.address, nonce: BigInt(dn)});
        const raws: Hex[] = [
          await signTx(d, dn, {
            data: encodeDeployData({abi, bytecode: MintableToken.bytecode, args: ['Bench', 'BNCH']}),
            gas: 3_000_000n,
          }),
        ];
        if (kind !== 'mint') {
          for (const s of deriveAccounts(p.seed, p.senders)) {
            const data = encodeFunctionData({abi, functionName: 'mint', args: [s.address, BigInt(p.n)]});
            raws.push(await signTx(d, next(d.address), {to: token, data, gas: 100_000n}));
          }
        }
        await settleSetup(approach, raws);
      },
      async generate(p) {
        const rx = receivers(p);
        const from = kind === 'mint' ? [deployer(p)] : deriveAccounts(p.seed, p.senders);
        return Promise.all(
          Array.from({length: p.n}, (_, i) => {
            const a = from[i % from.length]!;
            const to = rx[rxIndex(i)]!.address;
            const data =
              kind === 'mint'
                ? encodeFunctionData({abi, functionName: 'mint', args: [to, 1n]})
                : encodeFunctionData({abi, functionName: 'transfer', args: [to, 1n]});
            return signTx(a, next(a.address), {to: token, data, gas: 100_000n});
          }),
        );
      },
      async verify(approach, p) {
        const bals = await Promise.all(receivers(p).map((r) => balanceOf(approach, token, r.address)));
        const supply = await totalSupply(approach, token);
        if (kind === 'hot') {
          const lo = BigInt(Math.floor(p.n / 4));
          const hi = BigInt(Math.ceil(p.n / 4));
          const sum = bals.reduce((x, y) => x + y, 0n);
          const ok = sum === BigInt(p.n) && bals.every((b) => b === lo || b === hi);
          return {ok, detail: `balances ${bals.join(',')} sum ${sum}`};
        }
        const bad = bals.filter((b) => b !== 1n).length;
        const want = kind === 'mint' ? BigInt(p.n) : BigInt(p.senders) * BigInt(p.n);
        return {ok: bad === 0 && supply === want, detail: `${p.n - bad}/${p.n} receivers hold 1; supply ${supply} (want ${want})`};
      },
    };
  };
}

export const erc20Disjoint = make('disjoint');
export const erc20Hot = make('hot');
export const erc20Mint = make('mint');
