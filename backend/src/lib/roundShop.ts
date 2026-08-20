import type { Prisma, ProductStatus } from '@prisma/client';

const SHOP_STATUSES: ProductStatus[] = ['ACTIVE', 'SOLD_OUT'];

/** Хаах цаг нь ирсэн эсэх — cron төлөв солихоос өмнө ч захиалга хаагдсан гэж үзнэ. */
export function roundDeadlinePassed(closeAt: Date | null, now = new Date()): boolean {
  return closeAt !== null && closeAt.getTime() <= now.getTime();
}

/**
 * Дэлгүүрт харагдах тойрог: идэвхтэй/дууссан, хаах цаг нь хараахан болоогүй.
 * CLOSED болон `closeAt` хүрсэн урьдчилсан гаргалт нүүрэнд гарахгүй.
 */
export function shopRoundWhere(now = new Date()): Prisma.ProductRoundWhereInput {
  return {
    deletedAt: null,
    status: { in: SHOP_STATUSES },
    OR: [{ closeAt: null }, { closeAt: { gt: now } }],
  };
}
