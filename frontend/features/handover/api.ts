import { adminAuth, request } from "@/lib/api/client";
import type { AdminOrderDetail, HandoverCustomer, HandoverHistory, HandoverPayMethod } from "@/types";

export const adminHandoverApi = {
  handoverLookup: (code: string) =>
    request<
      AdminOrderDetail & {
        canHandOver: boolean;
        blockReason: string | null;
        pickableItemIds?: string[];
      }
    >("/admin/handover/lookup", { ...adminAuth, query: { code } }).then(
      (r) => r.data,
    ),

  handoverCustomer: (q: string) =>
    request<HandoverCustomer[]>("/admin/handover/customer", {
      ...adminAuth,
      query: { q },
    }).then((r) => r.data),

  handoverHistory: (year: number, month: number) =>
    request<HandoverHistory>("/admin/handover/history", {
      ...adminAuth,
      query: { year, month },
    }).then((r) => r.data),

  handoverPartial: (body: {
    itemIds: string[];
    collectedAmount?: number;
    method?: HandoverPayMethod;
    note?: string;
  }) =>
    request<{
      itemCount: number;
      orderIds: string[];
      completedOrderIds: string[];
    }>("/admin/handover/partial", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  handoverComplete: (
    orderId: string,
    body?: { collectedAmount?: number; method?: HandoverPayMethod; note?: string },
  ) =>
    request<AdminOrderDetail>(`/admin/handover/${orderId}/complete`, {
      ...adminAuth,
      method: "POST",
      body: body ?? {},
    }).then((r) => r.data),
};
