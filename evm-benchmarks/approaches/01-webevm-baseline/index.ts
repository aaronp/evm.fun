import {createNode, type PersistenceAdapter} from 'webevm';
import {keccak256} from 'viem';
import type {Address, Approach, ApproachFactory, Hex, Receipt} from '@evmb/core';

type Node = Awaited<ReturnType<typeof createNode>>;

/** setup() resets: the node starts empty but still saves into the host's persistence. */
const fresh = (p: PersistenceAdapter): PersistenceAdapter => ({load: async () => null, save: (s) => p.save(s)});

const factory: ApproachFactory = (_opts, host = {}) => {
  const persistence = host.persistence as PersistenceAdapter | undefined;
  let node: Node | undefined;
  let receipts = new Map<Hex, Receipt>();
  let waiters: (() => void)[] = [];
  let submitMs = 0;

  const notify = () => {
    const w = waiters;
    waiters = [];
    w.forEach((f) => f());
  };
  const record = (r: Receipt) => {
    receipts.set(r.hash, r);
    notify();
  };

  async function start(p: PersistenceAdapter | undefined, initialBalances?: Record<Address, bigint>) {
    await node?.dispose();
    receipts = new Map(); // blocks after a restored dump are gone, and so are their receipts
    notify(); // in-flight awaitSettled calls re-check against the new map instead of being orphaned
    submitMs = 0;
    node = await createNode({
      chainId: 31337,
      miningConfig: {type: 'auto'},
      initialBalances,
      ...(host.createEngine && {engine: (await host.createEngine()) as any}),
      ...(p && {persistence: p}),
    });
    // webevm only saves after a mine/auto send; make the reset durable now
    if (initialBalances && persistence) await persistence.save(await node!.dumpState());
  }

  const approach: Approach = {
    meta: {
      id: '01-webevm-baseline',
      title: 'webevm baseline (stock node, one tx per block)',
      runsIn: ['bun', 'browser'],
      engine: host.createEngine ? 'webevm@0.9.1+revm' : 'webevm@0.9.1',
      tradeoffs: {evm: true, stateRoot: 'none', log: 'memory', sigVerify: 'inline', execution: 'serial', notes: 'one tx per block'},
    },

    async setup({prefund, dump}) {
      await start(persistence && fresh(persistence), dump ? undefined : prefund);
      if (!dump) return;
      // into a fresh node: webevm's loadState only puts the dump's state, it never clears newer state
      await node!.loadState(dump as any);
      if (persistence) await persistence.save(await node!.dumpState());
    },

    async snapshot() {
      return node!.dumpState();
    },

    async restore(dump) {
      await approach.setup({prefund: {}, dump});
    },

    pending: () => 0,

    async open() {
      if (!persistence || !(await persistence.load())) throw new Error('01-webevm-baseline: nothing persisted to open');
      await start(persistence);
    },

    async request(method, params = []) {
      return node!.request({method, params});
    },

    async submit(rawTxs) {
      const t0 = performance.now();
      for (const raw of rawTxs) {
        const hash = keccak256(raw);
        const n = node!;
        try {
          const r: any = await n.request({method: 'eth_sendRawTransactionSync', params: [raw]});
          if (n !== node) throw new Error('chain was restored while the tx was in flight');
          record({
            hash,
            status: r.status === '0x1' ? 'success' : 'reverted',
            settledAt: performance.now(),
            contractAddress: r.contractAddress ?? undefined,
          });
        } catch (e) {
          record({hash, status: 'rejected', settledAt: performance.now(), error: e instanceof Error ? e.message : String(e)});
        }
      }
      submitMs += performance.now() - t0;
    },

    async awaitSettled(hashes) {
      for (let i = 0; ; ) {
        while (i < hashes.length && receipts.has(hashes[i]!)) i++;
        if (i === hashes.length) break;
        await new Promise<void>((res) => waiters.push(res));
      }
      return hashes.map((h) => receipts.get(h)!);
    },

    async call({to, data}) {
      return (await node!.request({method: 'eth_call', params: [{to, data}, 'latest']})) as Hex;
    },

    async getBalance(addr: Address) {
      return BigInt((await node!.request({method: 'eth_getBalance', params: [addr, 'latest']})) as string);
    },

    phases: () => ({submit: submitMs}),

    async dispose() {
      await node?.dispose();
      node = undefined;
    },
  };
  return approach;
};

export default factory;
