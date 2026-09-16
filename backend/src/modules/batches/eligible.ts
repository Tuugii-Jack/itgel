import { prisma } from '../../prisma.js';
import { addUbMonths, parseUbDay, startOfUbMonth, ubMonthKey } from '../../lib/date.js';
import { roundStats } from '../../services/roundStats.js';

export async function listEligibleMonths() {
  const rounds = await prisma.productRound.findMany({
    where: {
      deletedAt: null,
      batchId: null,
      closeAt: { not: null },
      status: 'CLOSED',
    },
    select: { closeAt: true },
  });

  const counts = new Map<string, number>();
  for (const r of rounds) {
    if (!r.closeAt) continue;
    const key = ubMonthKey(r.closeAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, count]) => {
      const [y, m] = key.split('-');
      return { year: Number(y), month: Number(m), key, count };
    });
}

export async function listEligibleRounds(year: number, month: number) {
  const monthStart = startOfUbMonth(
    parseUbDay(`${year}-${String(month).padStart(2, '0')}-01`),
  );
  const monthEnd = new Date(addUbMonths(monthStart, 1).getTime() - 1);

  const rounds = await prisma.productRound.findMany({
    where: {
      deletedAt: null,
      batchId: null,
      status: 'CLOSED',
      closeAt: { gte: monthStart, lte: monthEnd },
    },
    orderBy: { closeAt: 'desc' },
    include: {
      product: { select: { id: true, name: true, images: true } },
    },
  });

  const stats = await roundStats(rounds.map((r) => r.id));

  return {
    data: rounds.map((r) => {
      const s = stats.get(r.id);
      return {
        roundId: r.id,
        roundNo: r.roundNo,
        productId: r.product.id,
        name: r.product.name,
        image: r.product.images[0] ?? null,
        sellPrice: r.sellPrice,
        costPrice: r.costPrice,
        cargoFee: r.cargoFee,
        status: r.status,
        closeAt: r.closeAt?.toISOString() ?? null,
        orderedQty: s?.qty ?? 0,
        customerCount: s?.customerCount ?? 0,
      };
    }),
    meta: { year, month, total: rounds.length },
  };
}
