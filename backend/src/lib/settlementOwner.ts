/**
 * Итгэлд төлөх эзэн: захиалгын snapshot, дараа нь тохиргоо.
 * Эхний идэвхтэй LEASING админ руу буцахгүй.
 */
export function pickSettlementOwnerId(
  orderSnapshot: string | null | undefined,
  configuredAdminId: string | null | undefined,
): string | null {
  const snap = orderSnapshot?.trim() || null;
  if (snap) return snap;
  return configuredAdminId?.trim() || null;
}

/**
 * Автомат үүсгэлт: snapshot байвал түүнийг авна (идэвхгүй болсон ч).
 * OWNER_MISSING аль хэдийн бүртгэгдсэн бол одоогийн тохиргоог ашиглахгүй.
 */
export function resolveAutoSettlementOwner(input: {
  snapshot: string | null | undefined;
  configuredActiveId: string | null | undefined;
  hasOpenOwnerMissing: boolean;
}): string | null {
  const snap = input.snapshot?.trim() || null;
  if (snap) return snap;
  if (input.hasOpenOwnerMissing) return null;
  return input.configuredActiveId?.trim() || null;
}
