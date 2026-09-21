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
import { profitOf, splitAttributedAmount, subtotalOf } from './money.js';

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

export function leasingResaleOwnerIds(
  items: RoundOwnerRef[],
  opts?: { includeCancelled?: boolean },
): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.cancelledAt && !opts?.includeCancelled) continue;
    if (item.round?.ownerKind !== 'LEASING') continue;
    const id = item.round.ownerAdminId?.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

export function isMixedLeasingResale(
  order: { isLeasing?: boolean | null; payeeKind?: string | null },
  items: RoundOwnerRef[],
  opts?: { includeCancelled?: boolean },
): boolean {
  return isLeasingResale(order) && leasingResaleOwnerIds(items, opts).length > 1;
}

function assertLeasingMixedWriteBlocked(
  order: { isLeasing?: boolean | null; payeeKind?: string | null },
  items: RoundOwnerRef[],
  auth: LeasingAuth,
  message: string,
): void {
  if (isOwnerRole(auth.role)) return;
  if (isMixedLeasingResale(order, items, { includeCancelled: true })) {
    throw conflict(message);
  }
}

/** Хуучин холимог захиалгын мөнгийг LEASING бичихгүй. OWNER бичиж болно. Хадгалсан дүнг солихгүй. */
export function assertCanWriteScopedLeasingMoney(
  order: { isLeasing?: boolean | null; payeeKind?: string | null },
  items: RoundOwnerRef[],
  auth: LeasingAuth,
): void {
  assertCanWriteLeasingOrderMoney(order, auth.role);
  assertLeasingMixedWriteBlocked(
    order,
    items,
    auth,
    'Холимог эзэмшлийн захиалгын төлбөр/буцаалтыг эзэмшигч бүртгэнэ.',
  );
}

/** Төлөв, цуцлалт, сэргээлт, bulk, нөөц — LEASING холимог дээр бичихгүй. */
export function assertCanMutateScopedLeasingOrder(
  order: { isLeasing?: boolean | null; payeeKind?: string | null },
  items: RoundOwnerRef[],
  auth: LeasingAuth,
): void {
  assertLeasingMixedWriteBlocked(
    order,
    items,
    auth,
    'Холимог эзэмшлийн захиалгын төлөв/цуцлалтыг эзэмшигч хийнэ.',
  );
}

export type LeasingMoneyShare = {
  mixed: boolean;
  attributed: boolean;
  ownSubtotal: number;
  paidAmount: number;
  refundedAmount: number;
  dueAmount: number;
  unallocatedPaid: number;
  unallocatedRefunded: number;
};

function leasingActiveShares(items: RoundOwnerRef[]): { ownerId: string; subtotal: number }[] {
  const byOwner = new Map<string, number>();
  for (const item of items) {
    if (item.cancelledAt) continue;
    if (item.round?.ownerKind !== 'LEASING') continue;
    const ownerId = item.round.ownerAdminId?.trim();
    if (!ownerId) continue;
    byOwner.set(
      ownerId,
      (byOwner.get(ownerId) ?? 0) + (item.qty ?? 0) * (item.unitPrice ?? 0),
    );
  }
  return [...byOwner.entries()].map(([ownerId, subtotal]) => ({ ownerId, subtotal }));
}

export function leasingResaleMoneyShare(input: {
  ownerAdminId?: string;
  items: RoundOwnerRef[];
  paidAmount: number;
  refundedAmount: number;
  dueAmount: number;
}): LeasingMoneyShare {
  const active = input.items.filter(
    (item) => !item.cancelledAt && item.round?.ownerKind === 'LEASING',
  );
  const shares = leasingActiveShares(input.items);
  const mixed = shares.length > 1;
  const own = input.ownerAdminId
    ? active.filter((item) => item.round?.ownerAdminId === input.ownerAdminId)
    : active;
  const ownSubtotal = subtotalOf(
    own.map((item) => ({ qty: item.qty ?? 0, unitPrice: item.unitPrice ?? 0 })),
  );
  if (!input.ownerAdminId || !mixed) {
    return {
      mixed,
      attributed: false,
      ownSubtotal,
      paidAmount: input.paidAmount,
      refundedAmount: input.refundedAmount,
      dueAmount: input.dueAmount,
      unallocatedPaid: 0,
      unallocatedRefunded: 0,
    };
  }
  const paidSplit = splitAttributedAmount(input.paidAmount, shares);
  const refundSplit = splitAttributedAmount(input.refundedAmount, shares);
  const paidAmount = paidSplit.byOwner[input.ownerAdminId] ?? 0;
  const refundedAmount = refundSplit.byOwner[input.ownerAdminId] ?? 0;
  return {
    mixed: true,
    attributed: true,
    ownSubtotal,
    paidAmount,
    refundedAmount,
    dueAmount: ownSubtotal - (paidAmount - refundedAmount),
    unallocatedPaid: paidSplit.unallocated,
    unallocatedRefunded: refundSplit.unallocated,
  };
}

export function ownLeasingResaleItems<T extends RoundOwnerRef>(
  items: T[],
  ownerAdminId: string,
  opts?: { includeCancelled?: boolean },
): T[] {
  return items.filter((item) => {
    if (item.cancelledAt && !opts?.includeCancelled) return false;
    return item.round?.ownerKind === 'LEASING' && item.round.ownerAdminId === ownerAdminId;
  });
}

export type ScopedLeasingMoney = {
  mixedOwnership: boolean;
  attributedMoney: boolean;
  subtotal: number;
  paidAmount: number;
  refundedAmount: number;
  dueAmount: number;
  unallocatedPaid: number;
  unallocatedRefunded: number;
  itemCount: number;
  profit: number;
};

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
): ScopedLeasingMoney {
  const mixed = isMixedLeasingResale(order, items);
  if (!mixed || isOwnerRole(auth.role)) {
    return {
      mixedOwnership: mixed,
      attributedMoney: false,
      unallocatedPaid: 0,
      unallocatedRefunded: 0,
      ...stored,
    };
  }
  const own = ownLeasingResaleItems(items, auth.sub, { includeCancelled: true });
  const liveOwn = own.filter((item) => !item.cancelledAt);
  const share = leasingResaleMoneyShare({
    ownerAdminId: auth.sub,
    items,
    paidAmount: stored.paidAmount,
    refundedAmount: stored.refundedAmount,
    dueAmount: stored.dueAmount,
  });
  return {
    mixedOwnership: true,
    attributedMoney: true,
    subtotal: share.ownSubtotal,
    paidAmount: share.paidAmount,
    refundedAmount: share.refundedAmount,
    dueAmount: share.dueAmount,
    unallocatedPaid: share.unallocatedPaid,
    unallocatedRefunded: share.unallocatedRefunded,
    itemCount: liveOwn.reduce((sum, item) => sum + (item.qty ?? 0), 0),
    profit: profitOf(
      liveOwn.map((item) => ({
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
