/** Fixed-capacity FIFO over a preallocated array; head/tail indices, no reallocation. */
export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0; // next read
  size = 0;

  constructor(readonly capacity: number) {
    this.buf = new Array(capacity);
  }

  tryPush(x: T): boolean {
    if (this.size === this.capacity) return false;
    this.buf[(this.head + this.size++) % this.capacity] = x;
    return true;
  }

  drain(max: number): T[] {
    const n = Math.min(max, this.size);
    const out = new Array<T>(n);
    for (let i = 0; i < n; i++) {
      out[i] = this.buf[this.head]!;
      this.buf[this.head] = undefined; // drop the reference
      this.head = (this.head + 1) % this.capacity;
    }
    this.size -= n;
    return out;
  }
}
