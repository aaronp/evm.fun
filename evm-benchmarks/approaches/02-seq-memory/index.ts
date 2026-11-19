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
  let executeMs = 0;
  let mineMs = 0;

  const notify = () => {
    const w = waiters;
    waiters = [];
    w.forEach((f) => f());
  };
  const record = (r: Receipt) => {
    receipts.set(r.hash, r);
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

  async function teardown() {
    if (!run) return;
    run.stop = true;
    run.wake?.();
    run.seq.terminate();
    await run.node.dispose();
    run = undefined;
  }

  async function start(p: PersistenceAdapter | undefined, initialBalances?: Record<Address, bigint>) {
    await teardown();
    receipts = new Map();
    waiters = [];
    fatal = undefined;
    executeMs = mineMs = 0;
    const node = await createNode({
      chainId: 31337,
      senderMode: 'trusted',
      miningConfig: {type: 'manual'},
      blockGasLimit: BigInt(block) * MAX_TX_GAS, // a full block of the heaviest tx always fits
      initialBalances,
      ...(host.createEngine && {engine: (await host.createEngine()) as any}),
      ...(p && {persistence: p}),
    });
    // webevm only saves after a mine/auto send; make the reset durable now
    if (initialBalances && persistence) await persistence.save(await node.dumpState());
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
  }

  const approach: Approach = {
    meta: {
      id: '02-seq-memory',
      title: 'Sequencer + ring buffer, parallel sig pre-verify, batched blocks',
      runsIn: ['bun', 'browser'],
      engine: host.createEngine ? 'webevm@0.9.1+revm' : 'webevm@0.9.1',
      tradeoffs: {evm: true, stateRoot: 'none', log: 'memory', sigVerify: 'parallel-pre', execution: 'serial'},
    },

    async setup({prefund}) {
      await start(persistence && fresh(persistence), prefund);
    },

    async open() {
      if (!persistence || !(await persistence.load())) throw new Error('02-seq-memory: nothing persisted to open');
      await start(persistence);
    },

    async request(method, params = []) {
      return run!.node.request({method, params});
    },

    async submit(rawTxs) {
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
