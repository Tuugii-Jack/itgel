export type InventoryOwnerKind = 'SHOP' | 'LEASING';

export function isLeasingOwned(ownerKind?: string | null): boolean {
  return ownerKind === 'LEASING';
}

export function payeeKindOfRound(round: { ownerKind?: string | null }): InventoryOwnerKind {
  return isLeasingOwned(round.ownerKind) ? 'LEASING' : 'SHOP';
}

export function needsLeasingPayee(order: {
  isLeasing?: boolean | null;
  payeeKind?: string | null;
}): boolean {
  return order.isLeasing === true || order.payeeKind === 'LEASING';
}

export function isLeasingResale(order: {
  isLeasing?: boolean | null;
  payeeKind?: string | null;
}): boolean {
  return order.payeeKind === 'LEASING' && order.isLeasing !== true;
}

export function leasingOwnedProductWhere(adminId: string) {
  return {
    ownerKind: 'LEASING' as const,
    ownerAdminId: adminId,
    deletedAt: null,
  };
}

export function shopOwnedProductWhere() {
  return { ownerKind: 'SHOP' as const };
}

export function leasingOwnedRoundWhere(adminId: string) {
  return {
    ownerKind: 'LEASING' as const,
    ownerAdminId: adminId,
    deletedAt: null,
  };
}

export type CheckoutGroup<T> = {
  ownerKind: InventoryOwnerKind;
  ownerAdminId: string | null;
  items: T[];
};

/**
 * Checkout: SHOP нэг захиалга, LEASING эзэн (ownerAdminId) бүрээр тусдаа.
 * Эрэмбэ тогтвортой — ижил сагс ижил дараалал.
 */
export function splitCheckoutGroups<T extends { roundId: string }>(
  items: T[],
  roundById: Map<string, { ownerKind?: string | null; ownerAdminId?: string | null }>,
): CheckoutGroup<T>[] {
  const shop: T[] = [];
  const leasingByOwner = new Map<string, T[]>();
  for (const item of items) {
    const round = roundById.get(item.roundId);
    if (isLeasingOwned(round?.ownerKind)) {
      const key = round?.ownerAdminId?.trim() || '';
      const bucket = leasingByOwner.get(key) ?? [];
      bucket.push(item);
      leasingByOwner.set(key, bucket);
    } else {
      shop.push(item);
    }
  }
  const groups: CheckoutGroup<T>[] = [];
  if (shop.length > 0) {
    groups.push({ ownerKind: 'SHOP', ownerAdminId: null, items: shop });
  }
  for (const key of [...leasingByOwner.keys()].sort((a, b) => a.localeCompare(b))) {
    groups.push({
      ownerKind: 'LEASING',
      ownerAdminId: key || null,
      items: leasingByOwner.get(key)!,
    });
  }
  return groups;
}

export function splitItemsByPayee<T extends { roundId: string }>(
  items: T[],
  roundById: Map<string, { ownerKind?: string | null; ownerAdminId?: string | null }>,
): { shop: T[]; leasing: T[] } {
  const groups = splitCheckoutGroups(items, roundById);
  return {
    shop: groups.find((group) => group.ownerKind === 'SHOP')?.items ?? [],
    leasing: groups.filter((group) => group.ownerKind === 'LEASING').flatMap((group) => group.items),
  };
}

/** Холимог сагс: лизингийн эзэмшлийг хуваарьт лизинг болгохгүй. */
export function checkoutFlagsForGroup(
  ownerKind: InventoryOwnerKind,
  shopWantsLeasing: boolean,
): { isLeasing: boolean; payeeKind: InventoryOwnerKind } {
  if (ownerKind === 'LEASING') return { isLeasing: false, payeeKind: 'LEASING' };
  return {
    isLeasing: shopWantsLeasing,
    payeeKind: shopWantsLeasing ? 'LEASING' : 'SHOP',
  };
}

/** Дэлгүүрийн борлуулалтын тайлан — лизингийн бэлэн дахин борлуулалтыг хасна. */
export const SHOP_SALES_ORDER_WHERE = {
  deletedAt: null,
  NOT: { payeeKind: 'LEASING' as const, isLeasing: false },
};
