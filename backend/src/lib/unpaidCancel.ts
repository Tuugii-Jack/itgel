/**
 * 12 цаг (тохиргоо) өнгөрсөн, мөнгө огт ороогүй шинэ захиалга.
 * Ямар ч төлбөрийн мөр (QPay, шилжүүлэг, бэлэн) байвал орохгүй.
 * Шимтгэл төлөгдсөн лизингийн гэрээ CONFIRMED тул энд орохгүй.
 */
export function unpaidAutoDeleteWhere(cutoff: Date) {
  return {
    deletedAt: null,
    status: 'NEW' as const,
    paidAmount: 0,
    createdAt: { lte: cutoff },
    payments: { none: { kind: 'PAYMENT' as const } },
  };
}
