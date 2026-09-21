import { prisma } from '../../prisma.js';
import { conflict, notFound } from '../../lib/errors.js';
import { LEASING_INSTALLMENT_WHERE, assertCanWriteLeasingOrderMoney } from '../../lib/leasing.js';
import {
  assertCanMutateScopedLeasingOrder,
  assertCanWriteScopedLeasingMoney,
  leasingVisibleOrderWhere,
  type LeasingAuth,
} from '../../lib/leasingAccess.js';

export async function assertLeasingOrder(id: string) {
  const order = await prisma.order.findFirst({
    where: { id, OR: [LEASING_INSTALLMENT_WHERE, { payeeKind: 'LEASING', isLeasing: false }] },
    select: { id: true },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  return order;
}

export async function assertLeasingOrderAccess(id: string, auth: LeasingAuth) {
  const order = await prisma.order.findFirst({
    where: {
      id,
      AND: [
        { OR: [LEASING_INSTALLMENT_WHERE, { payeeKind: 'LEASING', isLeasing: false }] },
        leasingVisibleOrderWhere(auth),
      ],
    },
    select: {
      id: true,
      leasingOperatorAdminId: true,
      isLeasing: true,
      payeeKind: true,
    },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  return order;
}

export async function assertLeasingOrderMutation(id: string, auth: LeasingAuth) {
  const order = await prisma.order.findFirst({
    where: {
      id,
      AND: [
        { OR: [LEASING_INSTALLMENT_WHERE, { payeeKind: 'LEASING', isLeasing: false }] },
        leasingVisibleOrderWhere(auth),
      ],
    },
    select: {
      id: true,
      leasingOperatorAdminId: true,
      isLeasing: true,
      payeeKind: true,
      items: {
        select: { cancelledAt: true, round: { select: { ownerKind: true, ownerAdminId: true } } },
      },
    },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  assertCanMutateScopedLeasingOrder(order, order.items, auth);
  return order;
}

export async function assertLeasingOrderMoneyWrite(
  orderId: string,
  auth: { sub: string; role?: string },
) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true,
      isLeasing: true,
      payeeKind: true,
      items: {
        select: { cancelledAt: true, round: { select: { ownerKind: true, ownerAdminId: true } } },
      },
    },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');
  assertCanWriteLeasingOrderMoney(order, auth.role);
  if (auth.role === 'LEASING') {
    assertCanWriteScopedLeasingMoney(order, order.items, {
      sub: auth.sub,
      role: auth.role,
    });
  }
  return order;
}

/** Ready-transfer эзэн — захиалгын оператор эсвэл тойргийн LEASING админ. OWNER id биш. */
export async function resolveReadyTransferOwner(orderId: string): Promise<string> {
  const order = await prisma.order.findFirst({
    where: { id: orderId },
    select: {
      leasingOperatorAdminId: true,
      items: {
        where: { cancelledAt: null },
        select: { round: { select: { ownerAdminId: true, ownerKind: true } } },
      },
    },
  });
  if (!order) throw notFound('Захиалга олдсонгүй.');

  const fromRounds = [
    ...new Set(
      order.items
        .filter((item) => item.round?.ownerKind === 'LEASING' && item.round.ownerAdminId)
        .map((item) => item.round!.ownerAdminId as string),
    ),
  ];
  const preferred = order.leasingOperatorAdminId?.trim() || null;
  const ownerId =
    preferred && (fromRounds.length === 0 || fromRounds.includes(preferred))
      ? preferred
      : fromRounds.length === 1
        ? fromRounds[0]!
        : null;
  if (!ownerId) throw conflict('Бэлэн барааны эзэмшигч тодорхойгүй.');

  const admin = await prisma.adminUser.findUnique({
    where: { id: ownerId },
    select: { role: true, isActive: true },
  });
  if (!admin?.isActive || admin.role !== 'LEASING') {
    throw conflict('Бэлэн барааг зөвхөн лизингийн админы бүртгэлд шилжүүлнэ.');
  }
  return ownerId;
}
