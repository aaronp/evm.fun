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
  dispose(): Promise<void>;
}

export type ApproachFactory = (opts?: Record<string, string>) => Approach;
