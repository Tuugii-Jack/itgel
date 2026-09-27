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

  it('хэсэгчилсэн олголтын дараа үлдсэн ширхэг хураамжтай', () => {
    const now = addDays(arrived, 8);
    const r = computeStorageFee(
      [
        {
          arrivedAt: arrived,
          handedOverAt: addDays(arrived, 1),
          cancelledAt: null,
          qty: 10,
          arrivedQty: 10,
          handedOverQty: 2,
        },
      ],
      1000,
      7,
      now,
    );
    expect(r.billableItemDays).toBe(8);
    expect(r.fee).toBe(8_000);
  });

  it('4+6 ирээд 2 олгоход үлдсэн 8-ыг бүтэн ирсэн огнооноос бодно', () => {
    const firstWave = arrived;
    const secondWave = addDays(firstWave, 5);
    const now = addDays(secondWave, 8);
    const beforeFull = computeStorageFee(
      [
        {
          arrivedAt: null,
          handedOverAt: null,
          cancelledAt: null,
          qty: 10,
          arrivedQty: 4,
          handedOverQty: 0,
        },
      ],
      1000,
      7,
      addDays(firstWave, 3),
    );
    expect(beforeFull.fee).toBe(0);

    const after = computeStorageFee(
      [
        {
          arrivedAt: secondWave,
          handedOverAt: secondWave,
          cancelledAt: null,
          qty: 10,
          arrivedQty: 10,
          handedOverQty: 2,
        },
      ],
      1000,
      7,
      now,
    );
    expect(after.billableItemDays).toBe(8);
    expect(after.fee).toBe(8_000);
  });

  it('өөр өдөр ирсэн ширхэгт эхний ирэлтийг зохиож нэмэхгүй', () => {
    const lastWave = addDays(arrived, 3);
    const now = addDays(lastWave, 8);
    const r = computeStorageFee(
      [
        {
          arrivedAt: lastWave,
          handedOverAt: lastWave,
          cancelledAt: null,
          qty: 4,
          arrivedQty: 4,
          handedOverQty: 1,
        },
      ],
      1000,
      7,
      now,
    );
    expect(r.fee).toBe(3_000);
    expect(r.billableItemDays).toBe(3);
  });

  it('хэсэгчлэн ирсэн мөрөнд хураамж нэмэхгүй', () => {
    const now = addDays(arrived, 20);
    const r = computeStorageFee(
      [
        {
          arrivedAt: null,
          handedOverAt: null,
          cancelledAt: null,
          qty: 10,
          arrivedQty: 4,
          handedOverQty: 0,
        },
      ],
      1000,
      7,
      now,
    );
    expect(r.fee).toBe(0);
    expect(r.billableItemDays).toBe(0);
  });

  it('мөр бүрийн arrivedAt-аас тусдаа бодно — захиалга бүтнээр дуусахыг хүлээхгүй', () => {
    const later = addDays(arrived, 5);
    const now = addDays(arrived, 8);
    const r = computeStorageFee(
      [
        {
          arrivedAt: arrived,
          handedOverAt: null,
          cancelledAt: null,
          qty: 2,
          arrivedQty: 2,
          handedOverQty: 0,
        },
        {
          arrivedAt: later,
          handedOverAt: null,
          cancelledAt: null,
          qty: 3,
          arrivedQty: 3,
          handedOverQty: 0,
        },
      ],
      1000,
      7,
      now,
    );
    expect(r.billableItemDays).toBe(2);
    expect(r.fee).toBe(2_000);
  });

  it('хоёр дахь хэсэгчилсэн олголт үнэгүй хугацааг дахин эхлүүлэхгүй', () => {
    const now = addDays(arrived, 8);
    const r = computeStorageFee(
      [
        {
          arrivedAt: arrived,
          handedOverAt: addDays(arrived, 6),
          cancelledAt: null,
          qty: 10,
          arrivedQty: 10,
          handedOverQty: 5,
        },
      ],
      1000,
      7,
      now,
    );
    expect(r.billableItemDays).toBe(5);
    expect(r.fee).toBe(5_000);
  });

  it('бүртгэсэн хураамжийг бууруулахгүй', () => {
    const now = addDays(arrived, 8);
    const r = peekStorageFee(
      {
        id: 'o3',
        storageFee: 9_000,
        status: 'ARRIVED',
        items: [
          {
            arrivedAt: arrived,
            handedOverAt: null,
            cancelledAt: null,
            qty: 2,
            arrivedQty: 2,
            handedOverQty: 0,
            fulfilment: 'PICKUP',
          },
        ],
      },
      { storageFeePerDay: 1000, storageFreeDays: 7 },
      now,
    );
    expect(r.fee).toBe(9_000);
  });
});
