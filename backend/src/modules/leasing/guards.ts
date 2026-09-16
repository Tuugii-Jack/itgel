import { prisma } from '../../prisma.js';
import { notFound } from '../../lib/errors.js';
import { LEASING_INSTALLMENT_WHERE } from '../../lib/leasing.js';

export async function assertLeasingOrder(id: string) {
  const order = await prisma.order.findFirst({
    where: { id, OR: [LEASING_INSTALLMENT_WHERE, { payeeKind: 'LEASING', isLeasing: false }] },
    select: { id: true },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  return order;
}
