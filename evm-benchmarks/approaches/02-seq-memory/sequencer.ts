import type {Address, Hex} from '@evmb/core';
import type {RingBuffer} from './ring.ts';
import type {Verified, VerifyReply} from './verifyWorker.ts';

export type Sequenced = Verified & {from: Address};
export interface LogEntry {
  seq: number;
  raw: Hex;
  from: Address;
}

/**
 * Single writer: fans raw-tx chunks out to verify workers, then releases the verified chunks
 * into the ring strictly in seq order (a reorder map absorbs out-of-order worker replies).
 * When the ring is full it stops and resumes on the next release() call after a drain.
 */
export class Sequencer {
  readonly log: LogEntry[] = [];
  verifyMs = 0; // wall time with at least one chunk at a worker
  sequenceMs = 0; // main-thread time spent reordering and pushing
  private workers: Worker[];
  private pending = new Map<number, Verified[]>();
  private nextSeq = 0;
  private nextRelease = 0;
  private offset = 0; // position inside chunk nextRelease when the ring filled up
  private inFlight = 0;
  private busySince = 0;

  constructor(
    workers: number,
    private chunk: number,
    private ring: RingBuffer<Sequenced>,
    private on: {pushed(): void; rejected(v: Verified): void; fatal(e: Error): void},
  ) {
    this.workers = Array.from({length: workers}, () => {
      const w = new Worker(new URL('./verifyWorker.ts', import.meta.url), {type: 'module'});
      w.onmessage = (e: MessageEvent<VerifyReply>) => this.onVerified(e.data);
      w.onerror = (e) => on.fatal(new Error(`verify worker: ${e.message}`));
      return w;
    });
  }

  submit(raws: Hex[]) {
    for (let i = 0; i < raws.length; i += this.chunk) {
      if (this.inFlight++ === 0) this.busySince = performance.now();
      const seq = this.nextSeq++;
      this.workers[seq % this.workers.length]!.postMessage({seq, raws: raws.slice(i, i + this.chunk)});
    }
  }

  private onVerified({seq, items}: VerifyReply) {
    if (--this.inFlight === 0) this.verifyMs += performance.now() - this.busySince;
    this.pending.set(seq, items);
    this.release();
  }

  /** Push ready chunks in seq order until a gap or a full ring. */
  release() {
    const t0 = performance.now();
    let pushed = false;
    out: for (let items; (items = this.pending.get(this.nextRelease)); ) {
      for (; this.offset < items.length; this.offset++) {
        const it = items[this.offset]!;
        if (it.from === null) {
          this.on.rejected(it);
          continue;
        }
        if (!this.ring.tryPush(it as Sequenced)) break out; // backpressure: resume after the executor drains
        this.log.push({seq: this.nextRelease, raw: it.raw, from: it.from});
        pushed = true;
      }
      this.pending.delete(this.nextRelease++);
      this.offset = 0;
    }
    this.sequenceMs += performance.now() - t0;
    if (pushed) this.on.pushed();
  }

  terminate() {
    for (const w of this.workers) w.terminate();
  }
}
