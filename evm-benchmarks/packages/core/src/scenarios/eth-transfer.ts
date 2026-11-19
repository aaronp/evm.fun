import {deriveAccounts} from '../accounts.ts';
import {nonces, signTx} from '../tx.ts';
import type {Scenario} from './index.ts';

export const FUND = 10n ** 24n;

export const ethTransfer = (): Scenario => ({
  id: 'eth-transfer',
  prefund: (p) => Object.fromEntries(deriveAccounts(p.seed, p.senders).map((a) => [a.address, FUND])),
  async setup() {},
  async generate(p) {
    const from = deriveAccounts(p.seed, p.senders);
    const rx = deriveAccounts(p.seed + ':rx', p.n);
    const next = nonces();
    return Promise.all(
      rx.map((r, i) => {
        const a = from[i % p.senders]!;
        return signTx(a, next(a.address), {to: r.address, value: 1n, gas: 21_000n});
      }),
    );
  },
  async verify(approach, p) {
    const rx = deriveAccounts(p.seed + ':rx', p.n);
    const bals = await Promise.all(rx.map((r) => approach.getBalance(r.address)));
    const bad = bals.filter((b) => b !== 1n).length;
    return {ok: bad === 0, detail: `${p.n - bad}/${p.n} receivers hold 1 wei`};
  },
});
