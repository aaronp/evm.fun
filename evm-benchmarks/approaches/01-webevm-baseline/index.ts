import {createNode} from 'webevm';
import {keccak256} from 'viem';
import type {Address, Approach, ApproachFactory, Hex, Receipt} from '@evmb/core';

type Node = Awaited<ReturnType<typeof createNode>>;

const factory: ApproachFactory = () => {
  let node: Node | undefined;
  let receipts = new Map<Hex, Receipt>();
  let waiters: (() => void)[] = [];
  let submitMs = 0;

  const record = (r: Receipt) => {
    receipts.set(r.hash, r);
    const w = waiters;
    waiters = [];
    w.forEach((f) => f());
  };

  const approach: Approach = {
    meta: {
      id: '01-webevm-baseline',
      title: 'webevm baseline (stock node, one tx per block)',
      runsIn: ['bun', 'browser'],
      engine: 'webevm@0.9.1',
      tradeoffs: {evm: true, stateRoot: 'none', log: 'memory', sigVerify: 'inline', execution: 'serial', notes: 'one tx per block'},
    },

    async setup({prefund}) {
      await node?.dispose();
      receipts = new Map();
      waiters = [];
      submitMs = 0;
      node = await createNode({chainId: 31337, miningConfig: {type: 'auto'}, initialBalances: prefund});
    },

    async submit(rawTxs) {
      const t0 = performance.now();
      for (const raw of rawTxs) {
        const hash = keccak256(raw);
        try {
          const r: any = await node!.request({method: 'eth_sendRawTransactionSync', params: [raw]});
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
      while (!hashes.every((h) => receipts.has(h))) await new Promise<void>((res) => waiters.push(res));
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
