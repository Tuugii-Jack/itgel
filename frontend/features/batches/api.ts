import { adminAuth, request, type Query } from "@/lib/api/client";
import type { AdminBatch, AdminBatchDetail, BatchProduct, BatchSummary } from "@/types";

export const adminBatchesApi = {
  batches: (query?: Query) =>
    request<AdminBatch[]>("/admin/batches", { ...adminAuth, query }),

  batch: (id: string) =>
    request<AdminBatchDetail>(`/admin/batches/${id}`, adminAuth).then(
      (r) => r.data,
    ),

  createBatch: (body: {
    name: string;
    deadline?: string | null;
    orderIds?: string[];
    weightKg?: number;
    etaFrom?: string;
    etaTo?: string;
  }) =>
    request<AdminBatch>("/admin/batches", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  updateBatch: (
    id: string,
    body: Partial<{
      name: string;
      deadline: string | null;
      weightKg: number | null;
      etaFrom: string | null;
      etaTo: string | null;
    }>,
  ) =>
    request<BatchSummary>(`/admin/batches/${id}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  advanceBatch: (id: string) =>
    request<AdminBatch & { ordersMoved: number }>(
      `/admin/batches/${id}/advance`,
      {
        ...adminAuth,
        method: "POST",
      },
    ).then((r) => r.data),

  sendBatchArrivalSms: (
    batchId: string,
    body?: { orderId?: string; resend?: boolean },
  ) =>
    request<{
      sent: number;
      skipped: number;
      pending?: number;
      delivered?: number;
      unknown?: number;
      failed: { orderId: string; code: string; error: string }[];
    }>(`/admin/batches/${batchId}/arrival-sms`, {
      ...adminAuth,
      method: "POST",
      body: body ?? {},
    }).then((r) => r.data),

  /** Сонголт бүрийн ирсэн нийт тоог тавина (засаж болно). */
  registerBatchArrivals: (
    batchId: string,
    lines: {
      roundId: string;
      selections: Record<string, string>;
      arrivedQty: number;
    }[],
  ) =>
    request<{
      allocated: number;
      released: number;
      unused: number;
      ordersArrived: number;
      ordersReverted: number;
    }>(`/admin/batches/${batchId}/arrivals`, {
      ...adminAuth,
      method: "POST",
      body: { lines },
    }).then((r) => r.data),

  revertBatchStage: (id: string) =>
    request<AdminBatch & { ordersMoved: number }>(
      `/admin/batches/${id}/stage/revert`,
      {
        ...adminAuth,
        method: "POST",
      },
    ).then((r) => r.data),

  updateBatchOrders: (
    id: string,
    body: { add?: string[]; remove?: string[] },
  ) =>
    request<{ added: number; removed: number }>(`/admin/batches/${id}/orders`, {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  /** Багцын барааны нэгж карго үнийг хадгална — сонголт тус бүрээр. */
  saveBatchCargoFees: (
    batchId: string,
    items: {
      roundId: string;
      cargoFee: number;
      variants?: { selections: Record<string, string>; cargoFee: number }[];
    }[],
  ) =>
    request<{ saved: number; ordersUpdated: number }>(
      `/admin/batches/${batchId}/cargo-fees`,
      { ...adminAuth, method: "POST", body: { items } },
    ).then((r) => r.data),

  omitBatchOrder: (batchId: string, orderId: string) =>
    request<{ omitted: boolean }>(
      `/admin/batches/${batchId}/orders/${orderId}/omit`,
      {
        ...adminAuth,
        method: "POST",
      },
    ).then((r) => r.data),

  reinstateBatchOrder: (batchId: string, orderId: string) =>
    request<{ reinstated: boolean }>(
      `/admin/batches/${batchId}/orders/${orderId}/reinstate`,
      {
        ...adminAuth,
        method: "POST",
      },
    ).then((r) => r.data),

  /** Багцад нэмэх боломжтой хаагдсан гаргалтын сарууд. */
  batchEligibleMonths: () =>
    request<{ year: number; month: number; key: string; count: number }[]>(
      "/admin/batches/eligible-months",
      adminAuth,
    ).then((r) => r.data),

  /** Тухайн сарын хаагдсан, багцгүй гаргалт. */
  batchEligibleRounds: (year: number, month: number) =>
    request<BatchProduct[]>("/admin/batches/eligible-rounds", {
      ...adminAuth,
      query: { year, month },
    }).then((r) => r.data),

  /** Хаагдсан гаргалтыг багцад холбоно. */
  addBatchProduct: (
    batchId: string,
    body: { roundId?: string; roundIds?: string[] },
  ) =>
    request<BatchProduct | BatchProduct[]>(
      `/admin/batches/${batchId}/products`,
      {
        ...adminAuth,
        method: "POST",
        body,
      },
    ).then((r) => r.data),

  /** Багцаас бараа салгах — захиалгатай бол зөвхөн unlink. */
  removeBatchProduct: (batchId: string, roundId: string) =>
    request<{ removed: boolean; unlinked?: boolean }>(
      `/admin/batches/${batchId}/products/${roundId}`,
      {
        ...adminAuth,
        method: "DELETE",
      },
    ).then((r) => r.data),
};
