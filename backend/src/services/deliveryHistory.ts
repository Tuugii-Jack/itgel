import { prisma } from '../prisma.js';
import { addUbMonths, parseUbDay, startOfUbMonth, ubDateString } from '../lib/date.js';

export type DeliveryHistoryCourier = {
  name: string;
  count: number;
  delivered: number;
};

export type DeliveryHistoryDistrict = {
  name: string;
  count: number;
  delivered: number;
};

export type DeliveryHistoryDay = {
  date: string;
  total: number;
  pending: number;
  assigned: number;
  delivered: number;
  districts: DeliveryHistoryDistrict[];
  couriers: DeliveryHistoryCourier[];
};

/** Тухайн сарын хүргэлт — өдрөөр, дүүрэг/хүнээр. */
export async function deliveryHistory(year: number, month: number): Promise<{
  year: number;
  month: number;
  days: DeliveryHistoryDay[];
  summary: { total: number; pending: number; assigned: number; delivered: number };
}> {
  const from = startOfUbMonth(parseUbDay(`${year}-${String(month).padStart(2, '0')}-01`));
  const to = addUbMonths(from, 1);

  const rows = await prisma.delivery.findMany({
    where: { scheduledDay: { gte: from, lt: to } },
    select: {
      scheduledDay: true,
      district: true,
      courierName: true,
      status: true,
    },
  });

  const byDay = new Map<
    string,
    {
      pending: number;
      assigned: number;
      delivered: number;
      districts: Map<string, { count: number; delivered: number }>;
      couriers: Map<string, { count: number; delivered: number }>;
    }
  >();

  for (const row of rows) {
    const date = ubDateString(row.scheduledDay);
    const day = byDay.get(date) ?? {
      pending: 0,
      assigned: 0,
      delivered: 0,
      districts: new Map(),
      couriers: new Map(),
    };
    if (row.status === 'DELIVERED') day.delivered += 1;
    else if (row.status === 'ASSIGNED') day.assigned += 1;
    else day.pending += 1;

    const district = day.districts.get(row.district) ?? { count: 0, delivered: 0 };
    district.count += 1;
    if (row.status === 'DELIVERED') district.delivered += 1;
    day.districts.set(row.district, district);

    const courierKey = row.courierName?.trim() || '';
    if (courierKey) {
      const courier = day.couriers.get(courierKey) ?? { count: 0, delivered: 0 };
      courier.count += 1;
      if (row.status === 'DELIVERED') courier.delivered += 1;
      day.couriers.set(courierKey, courier);
    }

    byDay.set(date, day);
  }

  const days: DeliveryHistoryDay[] = [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, v]) => ({
      date,
      total: v.pending + v.assigned + v.delivered,
      pending: v.pending,
      assigned: v.assigned,
      delivered: v.delivered,
      districts: [...v.districts.entries()]
        .map(([name, d]) => ({ name, count: d.count, delivered: d.delivered }))
        .sort((a, b) => a.name.localeCompare(b.name, 'mn')),
      couriers: [...v.couriers.entries()]
        .map(([name, c]) => ({ name, count: c.count, delivered: c.delivered }))
        .sort((a, b) => a.name.localeCompare(b.name, 'mn')),
    }));

  return {
    year,
    month,
    days,
    summary: {
      total: days.reduce((s, d) => s + d.total, 0),
      pending: days.reduce((s, d) => s + d.pending, 0),
      assigned: days.reduce((s, d) => s + d.assigned, 0),
      delivered: days.reduce((s, d) => s + d.delivered, 0),
    },
  };
}
