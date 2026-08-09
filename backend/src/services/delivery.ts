import type { Prisma, Setting } from '@prisma/client';
import { prisma } from '../prisma.js';
import { addDays, endOfUbDay, startOfUbDay, ubDateString } from '../lib/date.js';

type Client = Pick<Prisma.TransactionClient, 'delivery'>;

/** Тухайн өдөрт үлдсэн хүргэлтийн сул хэмжээ. */
export async function remainingSlotsFor(
  day: Date,
  settings: Setting,
  client: Client = prisma,
): Promise<number> {
  const used = await client.delivery.count({
    where: {
      scheduledDay: { gte: startOfUbDay(day), lte: endOfUbDay(day) },
      status: { not: 'DELIVERED' },
    },
  });
  return Math.max(0, settings.deliveryDailyLimit - used);
}

export interface SlotInfo {
  day: string;
  capacity: number;
  used: number;
  remaining: number;
  available: boolean;
}

/** Маргаашаас эхлэн N хоногийн сул хэмжээ. */
export async function listSlots(settings: Setting, days = 14, now = new Date()): Promise<SlotInfo[]> {
  const from = startOfUbDay(addDays(now, 1));
  const to = endOfUbDay(addDays(from, days - 1));

  const deliveries = await prisma.delivery.findMany({
    where: { scheduledDay: { gte: from, lte: to }, status: { not: 'DELIVERED' } },
    select: { scheduledDay: true },
  });

  const usedByDay = new Map<string, number>();
  for (const d of deliveries) {
    const key = ubDateString(d.scheduledDay);
    usedByDay.set(key, (usedByDay.get(key) ?? 0) + 1);
  }

  return Array.from({ length: days }, (_, i) => {
    const day = ubDateString(addDays(from, i));
    const used = usedByDay.get(day) ?? 0;
    const remaining = Math.max(0, settings.deliveryDailyLimit - used);
    return { day, capacity: settings.deliveryDailyLimit, used, remaining, available: remaining > 0 };
  });
}
