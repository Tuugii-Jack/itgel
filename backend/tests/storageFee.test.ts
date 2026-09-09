import { describe, expect, it } from 'vitest';
import { addDays } from '../src/lib/date.js';
import { computeStorageFee, peekStorageFee } from '../src/services/storageFee.js';

describe('Агуулахын хадгалалтын хураамж', () => {
  const arrived = new Date('2026-08-01T04:00:00.000Z'); // UB Aug 1

  it('үнэгүй 7 хоногт хураамж 0', () => {
    const now = addDays(arrived, 7);
    const r = computeStorageFee(
      [{ arrivedAt: arrived, handedOverAt: null, cancelledAt: null, qty: 2 }],
      1000,
      7,
      now,
    );
    expect(r.fee).toBe(0);
    expect(r.freeDaysLeft).toBe(0);
  });

  it('8 дахь өдрөөс хоног × тоо × үнэ', () => {
    const now = addDays(arrived, 8);
    const r = computeStorageFee(
      [{ arrivedAt: arrived, handedOverAt: null, cancelledAt: null, qty: 2 }],
      1000,
      7,
      now,
    );
    expect(r.billableItemDays).toBe(2); // 1 day × qty 2
    expect(r.fee).toBe(2000);
  });

  it('авсан мөр тооцогдохгүй', () => {
    const now = addDays(arrived, 10);
    const r = computeStorageFee(
      [
        { arrivedAt: arrived, handedOverAt: addDays(arrived, 2), cancelledAt: null, qty: 1 },
        { arrivedAt: arrived, handedOverAt: null, cancelledAt: null, qty: 1 },
      ],
      1000,
      7,
      now,
    );
    expect(r.fee).toBe(3000); // 3 billable days × 1
  });

  it('хүргэлтээр сонгосон мөр тооцогдохгүй', () => {
    const now = addDays(arrived, 10);
    const r = computeStorageFee(
      [
        {
          arrivedAt: arrived,
          handedOverAt: null,
          cancelledAt: null,
          qty: 1,
          fulfilment: 'DELIVERY',
        },
        { arrivedAt: arrived, handedOverAt: null, cancelledAt: null, qty: 1, fulfilment: 'PICKUP' },
      ],
      1000,
      7,
      now,
    );
    expect(r.fee).toBe(3000);
  });

  it('бүгдийг хүргэлтээр авбал хураамж 0', () => {
    const now = addDays(arrived, 20);
    const r = computeStorageFee(
      [
        {
          arrivedAt: arrived,
          handedOverAt: null,
          cancelledAt: null,
          qty: 2,
          fulfilment: 'DELIVERY',
        },
      ],
      1000,
      7,
      now,
    );
    expect(r.fee).toBe(0);
    expect(r.billableItemDays).toBe(0);
  });

  it('хүргэлт сонгосны дараа өмнө бодсон хураамжийг хасна', () => {
    const now = addDays(arrived, 10);
    const r = peekStorageFee(
      {
        id: 'o1',
        storageFee: 3000,
        status: 'ARRIVED',
        items: [
          {
            arrivedAt: arrived,
            handedOverAt: null,
            cancelledAt: null,
            qty: 1,
            fulfilment: 'DELIVERY',
          },
        ],
      },
      { storageFeePerDay: 1000, storageFreeDays: 7 },
      now,
    );
    expect(r.fee).toBe(0);
  });

  it('хүргэлттэй холиход очиж авах мөрийн хураамж үлдэнэ', () => {
    const now = addDays(arrived, 10);
    const r = peekStorageFee(
      {
        id: 'o2',
        storageFee: 6000,
        status: 'ARRIVED',
        items: [
          {
            arrivedAt: arrived,
            handedOverAt: null,
            cancelledAt: null,
            qty: 1,
            fulfilment: 'DELIVERY',
          },
          {
            arrivedAt: arrived,
            handedOverAt: null,
            cancelledAt: null,
            qty: 1,
            fulfilment: 'PICKUP',
          },
        ],
      },
      { storageFeePerDay: 1000, storageFreeDays: 7 },
      now,
    );
    expect(r.fee).toBe(3000);
  });

  it('feePerDay=0 бол унтарна', () => {
    const now = addDays(arrived, 20);
    const r = computeStorageFee(
      [{ arrivedAt: arrived, handedOverAt: null, cancelledAt: null, qty: 1 }],
      0,
      7,
      now,
    );
    expect(r.fee).toBe(0);
  });
});
