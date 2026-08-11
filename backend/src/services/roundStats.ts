import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import type { RoundStats } from './serialize.js';

/**
 * Тойрог бүрд хэдэн хүн, хэдэн ширхэг авсныг НЭГ асуулгаар бодно.
 *
 * Нэгтгэлийг DB дээр хийнэ — мөр бүрийг Node руу татаж тоолбол олон
 * зарагдсан тойрогт хариу нь том, удаан болдог.
 *
 * Цуцлагдсан мөр, цуцлагдсан болон устгагдсан захиалгыг тооцохгүй —
 * нийлүүлэгч рүү захиалах тоо нь эдгээрийг агуулах ёсгүй.
 */
export async function roundStats(roundIds: string[]): Promise<Map<string, RoundStats>> {
  const map = new Map<string, RoundStats>();
  if (roundIds.length === 0) return map;

  const rows = await prisma.$queryRaw<{ roundId: string; qty: number; customerCount: number }[]>`
    SELECT oi."roundId",
           COALESCE(SUM(oi."qty"), 0)::int AS "qty",
           COUNT(DISTINCT o."customerId")::int AS "customerCount"
    FROM "OrderItem" oi
    JOIN "Order" o ON o."id" = oi."orderId"
    WHERE oi."roundId" IN (${Prisma.join(roundIds)})
      AND oi."cancelledAt" IS NULL
      AND o."deletedAt" IS NULL
      AND o."status" <> 'CANCELLED'
      AND o."batchOmittedAt" IS NULL
    GROUP BY oi."roundId"
  `;

  for (const row of rows) {
    map.set(row.roundId, { qty: row.qty, customerCount: row.customerCount });
  }
  return map;
}
