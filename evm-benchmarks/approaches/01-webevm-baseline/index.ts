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
  let generation = 0; // bumped on every node swap
  let restoring: Promise<void> | undefined;

  const notify = () => {
    const w = waiters;
    waiters = [];
    w.forEach((f) => f());
  };
  const record = (r: Receipt) => {
    receipts.set(r.hash, r);
    notify();
  };

  /** A new node whose saves only reach `p` while it is the live node (a replaced node can't clobber). */
  async function build(p: PersistenceAdapter | undefined, initialBalances?: Record<Address, bigint>) {
    let me: Node | undefined;
    me = await createNode({
      chainId: 31337,
      miningConfig: {type: 'auto'},
      initialBalances,
      ...(host.createEngine && {engine: (await host.createEngine()) as any}),
      ...(host.stateHistory && {stateHistory: host.stateHistory}),
      ...(p && {persistence: {load: () => p.load(), save: (s) => (node === me ? p.save(s) : Promise.resolve())}}),
    });
    return me;
  }

  /** Make `next` live in one tick (no await), then return the old node for the caller to dispose. */
  function swap(next: Node) {
    const old = node;
    generation++;
    node = next;
    receipts = new Map(); // blocks after a restored dump are gone, and so are their receipts
    submitMs = 0;
    notify(); // in-flight awaitSettled calls re-check against the new map instead of being orphaned
    return old;
  }

  /** Swap in `next`; `state` (if any) is saved in the same tick, so no older save can land after it. */
  async function goLive(next: Node, state: unknown) {
    const old = swap(next);
    const saved = state !== undefined && persistence ? persistence.save(state as any) : undefined;
    await old?.dispose();
    await saved;
  }

  async function start(p: PersistenceAdapter | undefined, initialBalances?: Record<Address, bigint>) {
    const next = await build(p, initialBalances);
    // webevm only saves after a mine/auto send; make the reset durable now
    await goLive(next, initialBalances && persistence ? await next.dumpState() : undefined);
  }

  /** Replace the chain with `dump`. The new node is built and loaded first, so a bad dump leaves the live chain untouched. */
  async function replace(dump: unknown) {
    let done = () => {};
    restoring = new Promise<void>((r) => (done = r));
    try {
      // a fresh node: webevm's loadState only puts the dump's state, it never clears newer state
      const next = await build(persistence && fresh(persistence));
      try {
        await next.loadState(dump as any);
      } catch (e) {
        await next.dispose().catch(() => {});
        throw e;
      }
      const state = persistence ? await next.dumpState() : undefined;
      await node?.dumpState().catch(() => {}); // drain: webevm serialises requests, so in-flight sends (and saves) land first
      await goLive(next, state);
    } finally {
      restoring = undefined;
      done();
    }
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
      if (dump) await replace(dump);
      else await start(persistence && fresh(persistence), prefund);
    },

    async snapshot() {
      return node!.dumpState();
    },

    async restore(dump) {
      await replace(dump);
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
        if (restoring) await restoring; // new sends go to the restored node
        const hash = keccak256(raw);
        const g = generation;
        let rc: Receipt;
        try {
          const r: any = await node!.request({method: 'eth_sendRawTransactionSync', params: [raw]});
          rc = {hash, status: r.status === '0x1' ? 'success' : 'reverted', settledAt: performance.now(), contractAddress: r.contractAddress ?? undefined};
        } catch (e) {
          rc = {hash, status: 'rejected', settledAt: performance.now(), error: e instanceof Error ? e.message : String(e)};
        }
        if (restoring) await restoring; // record into the map that survives the swap, so awaitSettled resolves
        if (g !== generation) rc = {hash, status: 'rejected', settledAt: performance.now(), error: 'chain was restored while the tx was in flight'};
        record(rc);
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
