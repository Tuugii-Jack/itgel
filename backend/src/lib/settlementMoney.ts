export type PayableSettlement = {
  id: string;
  remainingAmount: number;
  confirmedAt: Date;
};

export type SettlementAllocation = {
  settlementId: string;
  amount: number;
};

export type SettlementDisplayStatus =
  | 'UNPAID'
  | 'PARTIAL'
  | 'QPAY_PENDING'
  | 'BANK_PENDING'
  | 'PAID'
  | 'VOID';

export type PlanSettlementResult =
  | { ok: true; amount: number; allocations: SettlementAllocation[] }
  | { ok: false; message: string };

export function settlementDisplayStatus(row: {
  status: string;
  paidAmount: number;
  remainingAmount: number;
}): SettlementDisplayStatus {
  if (row.status === 'VOID') return 'VOID';
  if (row.status === 'PAID') return 'PAID';
  if (row.status === 'INVOICED') return 'QPAY_PENDING';
  if (row.status === 'PENDING_BANK') return 'BANK_PENDING';
  if (row.paidAmount > 0 && row.remainingAmount > 0) return 'PARTIAL';
  return 'UNPAID';
}

export function settlementDisplayLabel(status: SettlementDisplayStatus): string {
  if (status === 'PAID') return 'Төлсөн';
  if (status === 'PARTIAL') return 'Хэсэгчлэн төлсөн';
  if (status === 'QPAY_PENDING') return 'QPay хүлээгдэж байна';
  if (status === 'BANK_PENDING') return 'Дансны баталгаа хүлээж байна';
  if (status === 'VOID') return 'Хүчингүй';
  return 'Төлөөгүй';
}

export function parseWholeTugrik(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

export function selectedRemainingTotal(rows: { remainingAmount: number }[]): number {
  return rows.reduce((sum, row) => sum + row.remainingAmount, 0);
}

export function allocateFifo(
  settlements: PayableSettlement[],
  amount: number,
): SettlementAllocation[] {
  const ordered = [...settlements].sort((a, b) => {
    const byDate = a.confirmedAt.getTime() - b.confirmedAt.getTime();
    if (byDate !== 0) return byDate;
    return a.id.localeCompare(b.id);
  });
  let left = amount;
  const allocations: SettlementAllocation[] = [];
  for (const row of ordered) {
    if (left <= 0) break;
    const take = Math.min(row.remainingAmount, left);
    if (take <= 0) continue;
    allocations.push({ settlementId: row.id, amount: take });
    left -= take;
  }
  return allocations;
}

export function planSettlementPayment(
  settlements: PayableSettlement[],
  amountRaw: unknown,
  allocations?: SettlementAllocation[] | null,
): PlanSettlementResult {
  const amount = parseWholeTugrik(amountRaw);
  if (amount === null) return { ok: false, message: 'Дүнг бүхэл төгрөгөөр оруулна уу.' };
  if (amount <= 0) return { ok: false, message: 'Төлөх дүн 0-ээс их байна.' };
  const remaining = selectedRemainingTotal(settlements);
  if (amount > remaining) {
    return { ok: false, message: 'Сонгосон үлдэгдлээс илүү дүн оруулахгүй.' };
  }
  if (settlements.length === 0) {
    return { ok: false, message: 'Тооцоо сонгоно уу.' };
  }

  if (allocations && allocations.length > 0) {
    const byId = new Map(settlements.map((row) => [row.id, row]));
    const seen = new Set<string>();
    let sum = 0;
    for (const line of allocations) {
      if (seen.has(line.settlementId)) {
        return { ok: false, message: 'Нэг өрийг хоёр хуваарилалтад оруулахгүй.' };
      }
      seen.add(line.settlementId);
      const row = byId.get(line.settlementId);
      if (!row) return { ok: false, message: 'Сонгоогүй өрөнд хуваарилж болохгүй.' };
      const lineAmount = parseWholeTugrik(line.amount);
      if (lineAmount === null) return { ok: false, message: 'Дүнг бүхэл төгрөгөөр оруулна уу.' };
      if (lineAmount <= 0) return { ok: false, message: 'Төлөх дүн 0-ээс их байна.' };
      if (lineAmount > row.remainingAmount) {
        return { ok: false, message: 'Сонгосон үлдэгдлээс илүү дүн оруулахгүй.' };
      }
      sum += lineAmount;
    }
    if (sum !== amount) {
      return { ok: false, message: 'Хуваарилалт төлөх дүнтэй таарахгүй байна.' };
    }
    return {
      ok: true,
      amount,
      allocations: allocations.map((line) => ({
        settlementId: line.settlementId,
        amount: parseWholeTugrik(line.amount)!,
      })),
    };
  }

  const fifo = allocateFifo(settlements, amount);
  const applied = fifo.reduce((sum, line) => sum + line.amount, 0);
  if (applied !== amount) {
    return { ok: false, message: 'Сонгосон үлдэгдлээс илүү дүн оруулахгүй.' };
  }
  return { ok: true, amount, allocations: fifo };
}

/** CONFIRMED төлбөрийн өдөр — зөвхөн нотлогдсон confirmedAt. updatedAt-ийг төлсөн өдөр гэж үзэхгүй. */
export function paymentConfirmedAt(row: {
  status: string;
  confirmedAt: Date | null;
  updatedAt?: Date;
}): Date | null {
  if (row.status !== 'CONFIRMED') return row.confirmedAt;
  return row.confirmedAt;
}

export function confirmedAtLabel(row: {
  status: string;
  confirmedAt: Date | null;
  confirmedAtSource?: string | null;
}): 'recorded' | 'backfilled' | 'unknown' | null {
  if (row.status !== 'CONFIRMED') return null;
  if (!row.confirmedAt) return 'unknown';
  if (row.confirmedAtSource === 'AUDIT') return 'backfilled';
  return 'recorded';
}

export function encodeTimeIdCursor(row: { at: Date; id: string }) {
  return Buffer.from(`${row.at.toISOString()}\t${row.id}`).toString('base64url');
}

export function decodeTimeIdCursor(raw?: string | null): { at: Date; id: string } | null {
  if (!raw?.trim()) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString();
    const split = decoded.indexOf('\t');
    if (split <= 0) return null;
    const at = new Date(decoded.slice(0, split));
    const id = decoded.slice(split + 1);
    if (!id || Number.isNaN(at.getTime())) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export function sameAllocation(
  left: SettlementAllocation[],
  right: SettlementAllocation[],
): boolean {
  if (left.length !== right.length) return false;
  const byId = new Map(right.map((line) => [line.settlementId, line.amount]));
  for (const line of left) {
    if (byId.get(line.settlementId) !== line.amount) return false;
  }
  return true;
}
