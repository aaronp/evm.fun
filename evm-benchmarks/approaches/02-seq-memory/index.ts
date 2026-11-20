import {createNode, type PersistenceAdapter} from 'webevm';
import type {Address, Approach, ApproachFactory, Hex, Receipt} from '@evmb/core';
import {RingBuffer} from './ring.ts';
import {Sequencer, type Sequenced} from './sequencer.ts';

type Node = Awaited<ReturnType<typeof createNode>>;

/** setup() resets: the node starts empty but still saves into the host's persistence. */
const fresh = (p: PersistenceAdapter): PersistenceAdapter => ({load: async () => null, save: (s) => p.save(s)});

const MAX_TX_GAS = 3_000_000n; // largest fixed gas limit in the benchmark (deploy)

const factory: ApproachFactory = (opts = {}, host = {}) => {
  const persistence = host.persistence as PersistenceAdapter | undefined;
  const cores = (globalThis as any).navigator?.hardwareConcurrency ?? 2;
  const posInt = (k: string, d: number) => {
    const v = Number(opts[k] ?? d);
    if (!Number.isInteger(v) || v < 1) throw new Error(`02-seq-memory: ${k} must be a positive integer, got ${opts[k]}`);
    return v;
  };
  const workers = posInt('workers', Math.max(1, cores - 1));
  const block = posInt('block', 500);
  const chunk = posInt('chunk', 250);

  // all per-chain state; built in setup() so the factory allocates nothing
  let run:
    | {node: Node; ring: RingBuffer<Sequenced>; seq: Sequencer; stop: boolean; wake?: () => void}
    | undefined;
  let receipts = new Map<Hex, Receipt>();
  let waiters: (() => void)[] = [];
  let fatal: Error | undefined;
  let submitted = 0; // txs handed to submit(); pending = submitted - settled
  let settled = 0;
  let executeMs = 0;
  let restoring = false; // submit is refused while true
  let mineMs = 0;

  const notify = () => {
    const w = waiters;
    waiters = [];
    w.forEach((f) => f());
  };
  const record = (r: Receipt) => {
    receipts.set(r.hash, r);
    settled++;
    notify();
  };
  const fail = (e: Error) => {
    fatal ??= e;
    notify();
  };

  // executor: the only caller of the node while running
  async function execute(r: NonNullable<typeof run>) {
    while (!r.stop) {
      const txs = r.ring.drain(block);
      if (!txs.length) {
        await new Promise<void>((res) => (r.wake = res));
        continue;
      }
      r.seq.release(); // ring has room again
      const t0 = performance.now();
      const sent: Sequenced[] = [];
      for (const tx of txs) {
        try {
          await r.node.request({method: 'evm_sendRawTransactionAs', params: [tx.raw, tx.from]});
          sent.push(tx);
        } catch (e) {
          record({hash: tx.hash, status: 'rejected', settledAt: performance.now(), error: e instanceof Error ? e.message : String(e)});
        }
      }
      const t1 = performance.now();
      await r.node.mine();
      const settledAt = performance.now();
      mineMs += settledAt - t1;
      for (const tx of sent) {
        const rc: any = await r.node.request({method: 'eth_getTransactionReceipt', params: [tx.hash]});
        record(
          rc
            ? {hash: tx.hash, status: rc.status === '0x1' ? 'success' : 'reverted', settledAt, contractAddress: rc.contractAddress ?? undefined}
            : {hash: tx.hash, status: 'rejected', settledAt, error: 'not included in mined block'},
        );
      }
      executeMs += t1 - t0 + (performance.now() - settledAt);
    }
  }

  const stopRun = (r: NonNullable<typeof run>) => {
    r.stop = true;
    r.wake?.();
    r.seq.terminate();
    return r.node.dispose();
  };

  async function teardown() {
    if (!run) return;
    const r = run;
    run = undefined;
    await stopRun(r);
  }

  /** A new node whose saves only reach `p` while it is the live node (a replaced node can't clobber). */
  async function build(p: PersistenceAdapter | undefined, initialBalances?: Record<Address, bigint>) {
    let me: Node | undefined;
    me = await createNode({
      chainId: 31337,
      senderMode: 'trusted',
      miningConfig: {type: 'manual'},
      blockGasLimit: BigInt(block) * MAX_TX_GAS, // a full block of the heaviest tx always fits
      initialBalances,
      ...(host.createEngine && {engine: (await host.createEngine()) as any}),
      ...(host.stateHistory && {stateHistory: host.stateHistory}),
      ...(p && {persistence: {load: () => p.load(), save: (s) => (run?.node === me ? p.save(s) : Promise.resolve())}}),
    });
    return me;
  }

  /** Make `node` live with a new pipeline in one tick (no await); returns the old run for the caller to stop. */
  function swap(node: Node) {
    const old = run;
    receipts = new Map(); // blocks after a restored dump are gone, and so are their receipts
    fatal = undefined;
    submitted = settled = 0;
    executeMs = mineMs = 0;
    // ponytail: 4 blocks of headroom; more only matters if verify bursts outrun the executor for long
    const ring = new RingBuffer<Sequenced>(block * 4);
    const r: NonNullable<typeof run> = {
      node,
      ring,
      stop: false,
      seq: new Sequencer(workers, chunk, ring, {
        pushed: () => r.wake?.(),
        rejected: (v) => record({hash: v.hash, status: 'rejected', settledAt: performance.now(), error: v.error}),
        fatal: fail,
      }),
    };
    run = r;
    execute(r).catch((e) => {
      if (run === r) fail(e instanceof Error ? e : new Error(String(e)));
    });
    notify(); // in-flight awaitSettled calls re-check against the new map instead of being orphaned
    return old;
  }

  /** Swap in `next`; `state` (if any) is saved in the same tick, so no older save can land after it. */
  async function goLive(next: Node, state: unknown) {
    const old = swap(next);
    const saved = state !== undefined && persistence ? persistence.save(state as any) : undefined;
    if (old) await stopRun(old);
    await saved;
  }

  async function start(p: PersistenceAdapter | undefined, initialBalances?: Record<Address, bigint>) {
    const next = await build(p, initialBalances);
    // webevm only saves after a mine/auto send; make the reset durable now
    await goLive(next, initialBalances && persistence ? await next.dumpState() : undefined);
  }

  /** Replace the chain with `dump`. The new node is built and loaded first, so a bad dump leaves the live chain untouched. */
  async function replace(dump: unknown) {
    restoring = true;
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
      await run?.node.dumpState().catch(() => {}); // drain: webevm serialises requests, so anything in flight lands first
      await goLive(next, state);
    } finally {
      restoring = false;
    }
  }

  const approach: Approach = {
    meta: {
      id: '02-seq-memory',
      title: 'Sequencer + ring buffer, parallel sig pre-verify, batched blocks',
      runsIn: ['bun', 'browser'],
      engine: host.createEngine ? 'webevm@0.9.1+revm' : 'webevm@0.9.1',
      tradeoffs: {evm: true, stateRoot: 'none', log: 'memory', sigVerify: 'parallel-pre', execution: 'serial'},
    },

    async setup({prefund, dump}) {
      if (dump) await replace(dump);
      else await start(persistence && fresh(persistence), prefund);
    },

    async snapshot() {
      return run!.node.dumpState();
    },

    async restore(dump) {
      // the executor is the node's only caller while txs are in flight
      if (submitted !== settled) throw new Error(`02-seq-memory: restore refused, ${submitted - settled} txs pending`);
      await replace(dump);
    },

    pending: () => submitted - settled,

    async open() {
      if (!persistence || !(await persistence.load())) throw new Error('02-seq-memory: nothing persisted to open');
      await start(persistence);
    },

    async request(method, params = []) {
      return run!.node.request({method, params});
    },

    async submit(rawTxs) {
      // checked before counting, so a refused submit never leaves pending() > 0
      if (restoring) throw new Error('02-seq-memory: restore in progress');
      submitted += rawTxs.length;
      run!.seq.submit(rawTxs);
    },

    async awaitSettled(hashes) {
      // cursor: receipts are only added, so each hash is checked once until it settles (O(N) total)
      for (let i = 0; ; ) {
        while (i < hashes.length && receipts.has(hashes[i]!)) i++;
        if (i === hashes.length) break;
        if (fatal) throw fatal;
        await new Promise<void>((res) => waiters.push(res));
      }
      return hashes.map((h) => receipts.get(h)!);
    },

    async call({to, data}) {
      return (await run!.node.request({method: 'eth_call', params: [{to, data}, 'latest']})) as Hex;
    },

    async getBalance(addr: Address) {
      return BigInt((await run!.node.request({method: 'eth_getBalance', params: [addr, 'latest']})) as string);
    },

    phases: () => ({verifyMs: run?.seq.verifyMs ?? 0, sequenceMs: run?.seq.sequenceMs ?? 0, executeMs, mineMs}),

    dispose: teardown,
  };
  return approach;
};

export default factory;
