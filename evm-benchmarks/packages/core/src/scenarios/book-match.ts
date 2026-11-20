import {decodeFunctionResult, encodeDeployData, encodeFunctionData, getContractAddress, maxUint256, type Address, type Hex} from 'viem';
import {MintableToken, OrderBook, Settlement} from '@evmb/contracts';
import {domainOf, hashOrder, match, orderBookAbi, placeCall, settleCall, settlementAbi, signOrder, type Resting, type SignedOrder, type Wallet} from '@evmb/orderbook';
import {deriveAccounts} from '../accounts.ts';
import {counted, nonces, settleSetup, signTx} from '../tx.ts';
import {FUND} from './eth-transfer.ts';
import {balanceOf, txCount} from './erc20.ts';
import type {Scenario} from './index.ts';

const abi = MintableToken.abi;
const E18 = 10n ** 18n; // price (quote per base) and ask size are both one whole token
const FILLED = 2; // OrderBook.Status.Filled
const MAX_LEVELS = 20;

/**
 * n resting asks (1 base at 1 quote) made untimed by `senders` makers; the timed txs are n buys, by `senders` takers,
 * each crossing one ask: on-chain `place`, or off-chain `settle` (signing and matching happen in setup).
 */
const bookMatch = (offchain: boolean): Scenario => {
  const next = nonces();
  let venue: Address, base: Address, quote: Address;
  let takes: (() => Promise<Hex>)[] = [];
  const deployer = (seed: string) => deriveAccounts(seed + ':dep', 1)[0]!;
  const makers = (seed: string, s: number) => deriveAccounts(seed, s);
  const takers = (seed: string, s: number) => deriveAccounts(seed + ':t', s);
  let hashes: Hex[] = [];

  return {
    id: offchain ? 'book-match-offchain' : 'book-match-onchain',
    prefund: (p) =>
      Object.fromEntries(
        [deployer(p.seed), ...makers(p.seed, p.senders), ...takers(p.seed, p.senders)].map((a) => [a.address, FUND]),
      ),
    async setup(approach, p) {
      const d = deployer(p.seed);
      const dn = next(d.address);
      const addr = (k: number) => getContractAddress({from: d.address, nonce: BigInt(dn + k)});
      [base, quote, venue] = [addr(0), addr(1), addr(2)];
      const deploy = (data: Hex) => signTx(d, next(d.address), {data, gas: 5_000_000n});
      const book = offchain ? Settlement : OrderBook;
      await settleSetup(approach, [
        await signTx(d, dn, {data: encodeDeployData({abi, bytecode: MintableToken.bytecode, args: ['GBP', 'GBP']}), gas: 3_000_000n}),
        await deploy(encodeDeployData({abi, bytecode: MintableToken.bytecode, args: ['USD', 'USD']})),
        await deploy(encodeDeployData({abi: book.abi, bytecode: book.bytecode})),
      ]);

      const approve = encodeFunctionData({abi, functionName: 'approve', args: [venue, maxUint256]});
      const setup: Hex[] = [];
      const fund = async (who: Address, token: Address, count: number) => {
        const mint = encodeFunctionData({abi, functionName: 'mint', args: [who, BigInt(count) * E18]});
        setup.push(await signTx(d, next(d.address), {to: token, data: mint, gas: 100_000n}));
      };
      const ms = makers(p.seed, p.senders);
      const ts = takers(p.seed, p.senders);
      for (const [j, m] of ms.entries()) {
        await fund(m.address, base, txCount(p, j));
        setup.push(await signTx(m, next(m.address), {to: base, data: approve, gas: 60_000n}));
      }
      for (const [j, t] of ts.entries()) {
        await fund(t.address, quote, txCount(p, j));
        setup.push(await signTx(t, next(t.address), {to: quote, data: approve, gas: 60_000n}));
      }
      await settleSetup(approach, setup);

      if (!offchain) {
        // untimed: n resting asks (hint = the price: a level once the first ask exists)
        const asks: Hex[] = [];
        const a = {base, quote, side: 'sell', price: E18, amount: E18, maxLevels: MAX_LEVELS, hint: E18, rest: true} as const;
        for (const [j, m] of ms.entries())
          for (let k = 0; k < txCount(p, j); k++) asks.push(await signTx(m, next(m.address), {...placeCall(venue, a), gas: 600_000n}));
        await settleSetup(approach, asks);
        takes = Array.from({length: p.n}, (_, i) => {
          const t = ts[i % p.senders]!;
          const c = placeCall(venue, {...a, side: 'buy'});
          return () => signTx(t, next(t.address), {...c, gas: 800_000n});
        });
      } else {
        // untimed: sign n maker orders, match one taker buy to each with the pure matcher
        const domain = domainOf(31337, venue);
        const orders: SignedOrder[] = Array.from({length: p.n}, (_, i) => ({maker: ms[i % p.senders]!.address, base, quote, side: 1, price: E18, amount: E18, nonce: BigInt(i), expiry: 2n ** 40n}));
        const sigs = await Promise.all(orders.map((o, i) => signOrder(ms[i % p.senders] as unknown as Wallet, o, domain)));
        hashes = orders.map((o) => hashOrder(o, domain));
        const resting: Resting[] = orders.map((o, i) => ({id: String(i), owner: o.maker, side: 'sell', price: o.price, remaining: o.amount, seq: i}));
        takes = orders.map((_, i) => {
          const t = ts[i % p.senders]!;
          const r = match({side: 'buy', price: E18, amount: E18}, resting.filter((x) => x.remaining > 0n), MAX_LEVELS);
          const f = r.fills[0]!;
          resting[Number(f.id)]!.remaining -= f.amount;
          const c = settleCall(venue, [orders[Number(f.id)]!], [sigs[Number(f.id)]!], [f.amount]);
          return () => signTx(t, next(t.address), {...c, gas: 300_000n});
        });
      }
    },
    async generate(p, onSigned) {
      return counted(onSigned, takes);
    },
    async verify(approach, p) {
      const unfilled: number[] = [];
      if (offchain) {
        const fl = async (h: Hex) => {
          const data = encodeFunctionData({abi: settlementAbi, functionName: 'filled', args: [h]});
          return decodeFunctionResult({abi: settlementAbi, functionName: 'filled', data: await approach.call({to: venue, data})});
        };
        const fs = await Promise.all(hashes.map(fl));
        for (const [i, f] of fs.entries()) if (f !== E18) unfilled.push(i);
      } else {
        const st = async (id: number) => {
          const data = encodeFunctionData({abi: orderBookAbi, functionName: 'orders', args: [BigInt(id)]});
          return decodeFunctionResult({abi: orderBookAbi, functionName: 'orders', data: await approach.call({to: venue, data})}).status;
        };
        const ss = await Promise.all(Array.from({length: p.n}, (_, i) => st(i + 1)));
        for (const [i, s] of ss.entries()) if (s !== FILLED) unfilled.push(i);
      }
      if (unfilled.length) return {ok: false, detail: `resting orders not filled: ${unfilled.slice(0, 10).join(',')}`};

      const bad: string[] = [];
      for (const [j, t] of takers(p.seed, p.senders).entries()) {
        const [a, b] = await Promise.all([balanceOf(approach, base, t.address), balanceOf(approach, quote, t.address)]);
        if (a !== BigInt(txCount(p, j)) * E18 || b !== 0n) bad.push(`taker ${j}`);
      }
      for (const [j, m] of makers(p.seed, p.senders).entries()) {
        const [a, b] = await Promise.all([balanceOf(approach, base, m.address), balanceOf(approach, quote, m.address)]);
        if (a !== 0n || b !== BigInt(txCount(p, j)) * E18) bad.push(`maker ${j}`);
      }
      const tail = offchain ? '; off-chain matching runs untimed in setup' : '';
      return {ok: bad.length === 0, detail: bad.length ? `wrong balances: ${bad.join(',')}` : `all ${p.n} resting orders filled, tokens moved exactly${tail}`};
    },
  };
};

export const bookMatchOnchain = () => bookMatch(false);
export const bookMatchOffchain = () => bookMatch(true);
