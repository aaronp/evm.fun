export type Hex = `0x${string}`;
export type Address = Hex;

export interface Tradeoffs {
  evm: boolean;
  stateRoot: 'per-block' | 'deferred' | 'none';
  log: 'none' | 'memory' | 'file' | 'indexeddb';
  sigVerify: 'inline' | 'parallel-pre' | 'trusted';
  execution: 'serial' | 'parallel';
  notes?: string;
}

export interface ApproachMeta {
  id: string;
  title: string;
  runsIn: ('bun' | 'browser')[];
  /** engine name@version, shown in results */
  engine?: string;
  tradeoffs: Tradeoffs;
}

export interface Receipt {
  hash: Hex;
  status: 'success' | 'reverted' | 'rejected';
  /** performance.now() */
  settledAt: number;
  contractAddress?: Address;
  error?: string;
}

/** webevm dumpState() result, opaque to core */
export type ChainDump = unknown;

export interface Approach {
  meta: ApproachMeta;
  /** fresh chain each call */
  /** dump given: load it instead of applying prefund, and persist before returning */
  setup(opts: {prefund: Record<Address, bigint>; dump?: ChainDump}): Promise<void>;
  submit(rawTxs: Hex[]): Promise<void>;
  /** same order as hashes */
  awaitSettled(hashes: Hex[]): Promise<Receipt[]>;
  call(req: {to: Address; data: Hex}): Promise<Hex>;
  getBalance(addr: Address): Promise<bigint>;
  /** ms per phase since setup */
  phases?(): Record<string, number>;
  /** load the persisted chain (needs host.persistence); no reset; throws if nothing persisted */
  open?(): Promise<void>;
  /** EIP-1193 read pass-through to the node */
  request?(method: string, params?: unknown[]): Promise<unknown>;
  /** webevm dumpState() of the live node */
  snapshot?(): Promise<ChainDump>;
  /** replace the chain with the dump (restarts on a fresh node, then loadState); persists if persistence given */
  restore?(dump: ChainDump): Promise<void>;
  /** txs submitted but not yet settled */
  pending?(): number;
  dispose(): Promise<void>;
}

/** Host-supplied pieces; typed loosely so core stays free of webevm types. */
export interface ApproachHost {
  /** e.g. () => createRevmEngine({wasm}) */
  createEngine?: () => Promise<unknown>;
  /** webevm PersistenceAdapter */
  persistence?: unknown;
  /** webevm StateHistoryOptions: keep the last N blocks readable (eth_call at a past block). Playground chains only. */
  stateHistory?: {blocks: number};
}

export type ApproachFactory = (opts?: Record<string, string>, host?: ApproachHost) => Approach;
