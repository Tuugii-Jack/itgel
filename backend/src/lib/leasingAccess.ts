import type { Prisma } from '@prisma/client';
import { isOwnerRole } from './adminRoles.js';
import { badRequest, conflict, forbidden } from './errors.js';
import { isLeasingResale } from './inventoryOwner.js';
import {
  assertCanWriteLeasingOrderMoney,
  LEASING_INSTALLMENT_WHERE,
  LEASING_RESALE_WHERE,
  LEASING_STAFF_ORDER_WHERE,
} from './leasing.js';
import { attributedShare, profitOf, subtotalOf } from './money.js';

export type LeasingAuth = { sub: string; role: string };

/** LEASING зөвхөн өөрийнх, OWNER бүх лизингийн захиалга. */
export function leasingVisibleOrderWhere(auth: LeasingAuth): Prisma.OrderWhereInput {
  if (isOwnerRole(auth.role)) return { ...LEASING_STAFF_ORDER_WHERE };
  return {
    OR: [
      { AND: [LEASING_INSTALLMENT_WHERE, { leasingOperatorAdminId: auth.sub }] },
      {
        AND: [
          LEASING_RESALE_WHERE,
          {
            items: {
              some: {
                cancelledAt: null,
                round: { ownerKind: 'LEASING', ownerAdminId: auth.sub },
              },
            },
          },
        ],
      },
    ],
  };
}

export function leasingVisibleCustomerWhere(auth: LeasingAuth): Prisma.CustomerWhereInput {
  return {
    orders: {
      some: {
        deletedAt: null,
        AND: [leasingVisibleOrderWhere(auth)],
      },
    },
  };
}

/** OWNER бүх лизингийн бараа; LEASING зөвхөн өөрийнх. Эзэмшигчийг OWNER болгохгүй. */
export function leasingCatalogProductWhere(auth: LeasingAuth) {
  if (isOwnerRole(auth.role)) {
    return { ownerKind: 'LEASING' as const, deletedAt: null };
  }
  return {
    ownerKind: 'LEASING' as const,
    ownerAdminId: auth.sub,
    deletedAt: null,
  };
}

export function leasingCatalogRoundWhere(auth: LeasingAuth) {
  if (isOwnerRole(auth.role)) {
    return { ownerKind: 'LEASING' as const, deletedAt: null };
  }
  return {
    ownerKind: 'LEASING' as const,
    ownerAdminId: auth.sub,
    deletedAt: null,
  };
}

/** OWNER бүх тооцоо; LEASING зөвхөн өөрийн ownerAdminId. */
export function settlementOwnerFilter(auth: LeasingAuth): string | undefined {
  return isOwnerRole(auth.role) ? undefined : auth.sub;
}

export type RoundOwnerRef = {
  cancelledAt?: Date | string | null;
  qty?: number;
  unitPrice?: number;
  costPriceSnapshot?: number;
  round?: { ownerKind?: string | null; ownerAdminId?: string | null } | null;
};

export function leasingResaleOwnerIds(items: RoundOwnerRef[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.cancelledAt) continue;
    if (item.round?.ownerKind !== 'LEASING') continue;
    const id = item.round.ownerAdminId?.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

export function isMixedLeasingResale(
  order: { isLeasing?: boolean | null; payeeKind?: string | null },
  items: RoundOwnerRef[],
): boolean {
  return isLeasingResale(order) && leasingResaleOwnerIds(items).length > 1;
}

/** Хуучин холимог захиалгын мөнгийг LEASING бичихгүй. OWNER бичиж болно. Хадгалсан дүнг солихгүй. */
export function assertCanWriteScopedLeasingMoney(
  order: { isLeasing?: boolean | null; payeeKind?: string | null },
  items: RoundOwnerRef[],
  auth: LeasingAuth,
): void {
  assertCanWriteLeasingOrderMoney(order, auth.role);
  if (isOwnerRole(auth.role)) return;
  if (isMixedLeasingResale(order, items)) {
    throw conflict('Холимог эзэмшлийн захиалгын төлбөр/буцаалтыг эзэмшигч бүртгэнэ.');
  }
}

export function leasingResaleMoneyShare(input: {
  ownerAdminId?: string;
  items: RoundOwnerRef[];
  paidAmount: number;
  refundedAmount: number;
  dueAmount: number;
}): {
  mixed: boolean;
  ownSubtotal: number;
  paidAmount: number;
  refundedAmount: number;
  dueAmount: number;
} {
  const active = input.items.filter(
    (item) => !item.cancelledAt && item.round?.ownerKind === 'LEASING',
  );
  const mixed = leasingResaleOwnerIds(input.items).length > 1;
  const own = input.ownerAdminId
    ? active.filter((item) => item.round?.ownerAdminId === input.ownerAdminId)
    : active;
  const ownSubtotal = subtotalOf(
    own.map((item) => ({ qty: item.qty ?? 0, unitPrice: item.unitPrice ?? 0 })),
  );
  if (!input.ownerAdminId || !mixed) {
    return {
      mixed,
      ownSubtotal,
      paidAmount: input.paidAmount,
      refundedAmount: input.refundedAmount,
      dueAmount: input.dueAmount,
    };
  }
  const allSubtotal = subtotalOf(
    active.map((item) => ({ qty: item.qty ?? 0, unitPrice: item.unitPrice ?? 0 })),
  );
  const paidAmount = attributedShare(input.paidAmount, ownSubtotal, allSubtotal);
  const refundedAmount = attributedShare(input.refundedAmount, ownSubtotal, allSubtotal);
  return {
    mixed: true,
    ownSubtotal,
    paidAmount,
    refundedAmount,
    dueAmount: Math.max(0, ownSubtotal - (paidAmount - refundedAmount)),
  };
}

export function ownLeasingResaleItems<T extends RoundOwnerRef>(
  items: T[],
  ownerAdminId: string,
): T[] {
  return items.filter(
    (item) =>
      !item.cancelledAt &&
      item.round?.ownerKind === 'LEASING' &&
      item.round.ownerAdminId === ownerAdminId,
  );
}

export function scopedLeasingListMoney(
  auth: LeasingAuth,
  order: { isLeasing?: boolean | null; payeeKind?: string | null },
  items: RoundOwnerRef[],
  stored: {
    subtotal: number;
    paidAmount: number;
    refundedAmount: number;
    dueAmount: number;
    itemCount: number;
    profit: number;
  },
): {
  mixedOwnership: boolean;
  subtotal: number;
  paidAmount: number;
  refundedAmount: number;
  dueAmount: number;
  itemCount: number;
  profit: number;
} {
  const mixed = isMixedLeasingResale(order, items);
  if (!mixed || isOwnerRole(auth.role)) {
    return { mixedOwnership: mixed, ...stored };
  }
  const own = ownLeasingResaleItems(items, auth.sub);
  const share = leasingResaleMoneyShare({
    ownerAdminId: auth.sub,
    items,
    paidAmount: stored.paidAmount,
    refundedAmount: stored.refundedAmount,
    dueAmount: stored.dueAmount,
  });
  return {
    mixedOwnership: true,
    subtotal: share.ownSubtotal,
    paidAmount: share.paidAmount,
    refundedAmount: share.refundedAmount,
    dueAmount: share.dueAmount,
    itemCount: own.reduce((sum, item) => sum + (item.qty ?? 0), 0),
    profit: profitOf(
      own.map((item) => ({
        qty: item.qty ?? 0,
        unitPrice: item.unitPrice ?? 0,
        costPriceSnapshot: item.costPriceSnapshot,
      })),
    ),
  };
}

/**
 * OWNER идэвхтэй LEASING эзэн сонгоно. LEASING зөвхөн өөртөө үүсгэнэ.
 * Барааны эзэн сонгосон LEASING; actor нь дуудлага хийгч.
 */
export function resolveLeasingCatalogOwnerId(
  auth: LeasingAuth,
  requestedOwnerId: string | undefined,
  target: { role: string; isActive: boolean } | null,
): string {
  const requested = requestedOwnerId?.trim() || undefined;
  if (isOwnerRole(auth.role)) {
    if (!requested) throw badRequest('Лизингийн эзэмшигч сонгоно уу.');
    if (!target?.isActive || target.role !== 'LEASING') {
      throw badRequest('Идэвхтэй лизингийн админ сонгоно уу.');
    }
    return requested;
  }
  if (requested && requested !== auth.sub) {
    throw forbidden('Өөр эзэнд бараа үүсгэх эрхгүй.');
  }
  return auth.sub;
}
