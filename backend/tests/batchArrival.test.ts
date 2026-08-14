import { describe, expect, it } from 'vitest';
import { allocateFifo, deallocateLifo, type WaitingLine } from '../src/services/batchArrival.js';

function line(
  id: string,
  orderId: string,
  qty: number,
  createdAt: string,
  arrivedQty = 0,
): WaitingLine {
  return { id, orderId, qty, arrivedQty, orderCreatedAt: new Date(createdAt) };
}

describe('Ирсэн бараа FIFO', () => {
  it('түрүүлж захиалсан хүнд эхлээд хуваарилна', () => {
    const items = [
      line('c', 'oc', 1, '2026-08-03T00:00:00Z'),
      line('a', 'oa', 1, '2026-08-01T00:00:00Z'),
      line('b', 'ob', 1, '2026-08-02T00:00:00Z'),
      line('d', 'od', 1, '2026-08-04T00:00:00Z'),
      line('e', 'oe', 1, '2026-08-05T00:00:00Z'),
    ];
    const { allocations, unused } = allocateFifo(items, 3);
    expect(unused).toBe(0);
    expect(allocations.map((a) => a.orderId)).toEqual(['oa', 'ob', 'oc']);
    expect(allocations.every((a) => a.fullyArrived)).toBe(true);
  });

  it('эхний хүний 2 ширхэгийг бүрэн дүүргээд дараагийнхыг хүлээлгэнэ', () => {
    const items = [
      line('a', 'oa', 2, '2026-08-01T00:00:00Z'),
      line('b', 'ob', 1, '2026-08-02T00:00:00Z'),
    ];
    const first = allocateFifo(items, 2);
    expect(first.allocations).toEqual([
      { id: 'a', orderId: 'oa', add: 2, fullyArrived: true },
    ]);
    expect(first.unused).toBe(0);
  });

  it('дутуу ирвэл эхний мөрийг хэсэгчлэн дүүргэнэ, дараагийн давалгаанд үргэлжилнэ', () => {
    const a = line('a', 'oa', 2, '2026-08-01T00:00:00Z');
    const b = line('b', 'ob', 1, '2026-08-02T00:00:00Z');
    const wave1 = allocateFifo([a, b], 1);
    expect(wave1.allocations).toEqual([
      { id: 'a', orderId: 'oa', add: 1, fullyArrived: false },
    ]);

    const a2 = { ...a, arrivedQty: 1 };
    const wave2 = allocateFifo([a2, b], 2);
    expect(wave2.allocations).toEqual([
      { id: 'a', orderId: 'oa', add: 1, fullyArrived: true },
      { id: 'b', orderId: 'ob', add: 1, fullyArrived: true },
    ]);
    expect(wave2.unused).toBe(0);
  });

  it('зассан тоо сүүлд хуваарилсан хүмүүсээс буцаана', () => {
    const items = [
      line('a', 'oa', 1, '2026-08-01T00:00:00Z', 1),
      line('b', 'ob', 1, '2026-08-02T00:00:00Z', 1),
      line('c', 'oc', 1, '2026-08-03T00:00:00Z', 1),
    ];
    const { changes, shortfall } = deallocateLifo(items, 2);
    expect(shortfall).toBe(0);
    expect(changes.map((c) => c.orderId)).toEqual(['oc', 'ob']);
    expect(changes.every((c) => c.add === -1 && !c.fullyArrived)).toBe(true);
  });

  it('хэсэгчилсэн мөрөөс ч буцаана', () => {
    const a = line('a', 'oa', 2, '2026-08-01T00:00:00Z', 2);
    const { changes, shortfall } = deallocateLifo([a], 1);
    expect(shortfall).toBe(0);
    expect(changes).toEqual([{ id: 'a', orderId: 'oa', add: -1, fullyArrived: false }]);
  });

  it('захиалснаас илүү ирвэл илүүдэл үлдэнэ', () => {
    const { allocations, unused } = allocateFifo(
      [line('a', 'oa', 1, '2026-08-01T00:00:00Z')],
      5,
    );
    expect(allocations[0]?.add).toBe(1);
    expect(unused).toBe(4);
  });
});
