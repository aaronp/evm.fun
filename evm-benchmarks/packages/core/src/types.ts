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

export interface Approach {
  meta: ApproachMeta;
  /** fresh chain each call */
  setup(opts: {prefund: Record<Address, bigint>}): Promise<void>;
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
  dispose(): Promise<void>;
}

/** Host-supplied pieces; typed loosely so core stays free of webevm types. */
export interface ApproachHost {
  /** e.g. () => createRevmEngine({wasm}) */
  createEngine?: () => Promise<unknown>;
  /** webevm PersistenceAdapter */
  persistence?: unknown;
}

export type ApproachFactory = (opts?: Record<string, string>, host?: ApproachHost) => Approach;
