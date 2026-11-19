import {expect, test} from 'bun:test';
import {RingBuffer} from './ring.ts';

test('tryPush fails at capacity', () => {
  const r = new RingBuffer<number>(3);
  expect([1, 2, 3, 4].map((x) => r.tryPush(x))).toEqual([true, true, true, false]);
  expect(r.size).toBe(3);
});

test('drain returns FIFO order up to max', () => {
  const r = new RingBuffer<number>(5);
  for (const x of [1, 2, 3, 4, 5]) r.tryPush(x);
  expect(r.drain(3)).toEqual([1, 2, 3]);
  expect(r.size).toBe(2);
  expect(r.drain(10)).toEqual([4, 5]);
  expect(r.drain(1)).toEqual([]);
});

test('wrap-around keeps order', () => {
  const r = new RingBuffer<number>(4);
  const out: number[] = [];
  let next = 0;
  for (let round = 0; round < 10; round++) {
    while (r.tryPush(next)) next++;
    out.push(...r.drain(3));
  }
  out.push(...r.drain(4));
  expect(out).toEqual(Array.from({length: next}, (_, i) => i));
});
