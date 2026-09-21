import type { SettlementInvoice } from "./types";

export type SettlementPick = { remaining: number; orderId: string };

export type SelectableSettlement = {
  id: string;
  remainingAmount: number;
  orderId: string;
  selectable: boolean;
};

export type PendingQpay = {
  id: string;
  method: string;
  status: string;
  invoice?: SettlementInvoice | null;
  invoicePending?: boolean;
};

export type LivePreview = {
  amount: number;
  allocations: { settlementId: string; amount: number }[];
};

export function mergeSelectionOnReload(
  prev: Map<string, SettlementPick>,
  pageRows: SelectableSettlement[],
): Map<string, SettlementPick> {
  const next = new Map(prev);
  for (const [id] of prev) {
    const row = pageRows.find((line) => line.id === id);
    if (row && !row.selectable) next.delete(id);
    else if (row) next.set(id, { remaining: row.remainingAmount, orderId: row.orderId });
  }
  return next;
}

export function mergeSelectionOnPage(
  prev: Map<string, SettlementPick>,
  pageRows: SelectableSettlement[],
): Map<string, SettlementPick> {
  const next = new Map(prev);
  for (const row of pageRows) {
    if (!next.has(row.id)) continue;
    if (row.selectable) next.set(row.id, { remaining: row.remainingAmount, orderId: row.orderId });
    else next.delete(row.id);
  }
  return next;
}

export function appendUniqueById<T extends { id: string }>(current: T[], extra: T[]): T[] {
  const seen = new Set(current.map((row) => row.id));
  return [...current, ...extra.filter((row) => !seen.has(row.id))];
}

export function selectedRemainingTotal(selected: Map<string, SettlementPick>): number {
  return [...selected.values()].reduce((sum, row) => sum + row.remaining, 0);
}

export function restoredQpay(pending: PendingQpay[]): PendingQpay | null {
  return pending.find((row) => row.method === "QPAY" && row.status === "PENDING") ?? null;
}

export function payRequestFromPreview(preview: LivePreview) {
  return {
    settlementIds: preview.allocations.map((line) => line.settlementId),
    amount: preview.amount,
    allocations: preview.allocations.map((line) => ({
      settlementId: line.settlementId,
      amount: line.amount,
    })),
  };
}

export function historyDateLabel(row: {
  confirmedAt?: string | null;
  confirmedAtSource?: string | null;
}): string {
  if (!row.confirmedAt) return "огноо тодорхойгүй";
  const day = row.confirmedAt.slice(0, 10);
  return row.confirmedAtSource === "AUDIT" ? `${day} · нөхсөн огноо` : day;
}

export function emptyPayUiState() {
  return {
    selected: new Map<string, SettlementPick>(),
    invoice: null,
    paymentId: null as string | null,
    preview: null,
  };
}
