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

export function splitItemsByPayee<T extends { roundId: string }>(
  items: T[],
  roundById: Map<string, { ownerKind?: string | null }>,
): { shop: T[]; leasing: T[] } {
  const shop: T[] = [];
  const leasing: T[] = [];
  for (const item of items) {
    const round = roundById.get(item.roundId);
    if (isLeasingOwned(round?.ownerKind)) leasing.push(item);
    else shop.push(item);
  }
  return { shop, leasing };
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
