import { adminAuth, request } from "@/lib/api/client";
import type { AdminStaffUser, AdminSummary, AuditLog, ProductReportRow, RevenueReport, Settings } from "@/types";

export const adminReportsApi = {
  summary: () =>
    request<AdminSummary>("/admin/reports/summary", adminAuth).then(
      (r) => r.data,
    ),
  revenue: (period: "3m" | "6m" | "1y", productIds?: string[]) =>
    request<RevenueReport>("/admin/reports/revenue", {
      ...adminAuth,
      query: {
        period,
        productIds: productIds && productIds.length > 0 ? productIds.join(",") : undefined,
      },
    }).then((r) => r.data),

  productReport: (period: "3m" | "6m" | "1y", limit = 200, productIds?: string[]) =>
    request<ProductReportRow[]>("/admin/reports/products", {
      ...adminAuth,
      query: {
        period,
        limit,
        productIds: productIds && productIds.length > 0 ? productIds.join(",") : undefined,
      },
    }).then((r) => r.data),

  settings: () =>
    request<Settings>("/admin/settings", adminAuth).then((r) => r.data),

  updateSettings: (body: Partial<Settings>) =>
    request<Settings>("/admin/settings", {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  /** Өөрчлөлтийн бүртгэл. Тодорхой бичлэгээр шүүж болно. */
  audit: (query?: { entity?: string; entityId?: string; limit?: number }) =>
    request<AuditLog[]>("/admin/settings/audit", { ...adminAuth, query }).then(
      (r) => r.data,
    ),
  staffUsers: () =>
    request<AdminStaffUser[]>("/admin/staff", adminAuth).then((r) => r.data),

  createStaffUser: (body: {
    email: string;
    name: string;
    password: string;
    role?: "STAFF" | "LEASING";
  }) =>
    request<AdminStaffUser>("/admin/staff", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  updateStaffUser: (
    id: string,
    body: { name?: string; password?: string; isActive?: boolean },
  ) =>
    request<AdminStaffUser>(`/admin/staff/${id}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  leasingSettlementOperators: () =>
    request<{ id: string; name: string; email: string; isActive: boolean }[]>(
      "/admin/leasing-settlements/operators",
      adminAuth,
    ).then((r) => r.data),

  checkSmsDelivery: () =>
    request<{ checked: number; delivered: number }>("/admin/settings/sms-delivery-check", {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  leasingSettlements: (query?: {
    day?: string;
    from?: string;
    to?: string;
    ownerAdminId?: string;
    status?: string;
    q?: string;
    remaining?: string;
    cursor?: string;
    take?: number;
  }) =>
    request<import("@/features/leasing/settlements/types").SettlementLine[]>(
      "/admin/leasing-settlements/settlements",
      { ...adminAuth, query },
    ).then((r) => ({
      rows: r.data,
      nextCursor: (r.meta?.nextCursor as string | null | undefined) ?? null,
      totals: (r.meta?.totals as import("@/features/leasing/settlements/types").SettlementListPage["totals"]) ?? {
        count: r.data.length,
        remainingAmount: 0,
        amount: 0,
        paidAmount: 0,
      },
    })),

  leasingSettlementSummary: (query?: { day?: string; ownerAdminId?: string }) =>
    request<import("@/features/leasing/settlements/types").SettlementSummary>(
      "/admin/leasing-settlements/summary",
      { ...adminAuth, query },
    ).then((r) => r.data),

  leasingSettlementPayments: (query?: {
    status?: string;
    ownerAdminId?: string;
    from?: string;
    to?: string;
    cursor?: string;
    take?: number;
  }) =>
    request<import("@/features/leasing/settlements/types").SettlementPayment[]>(
      "/admin/leasing-settlements/payments",
      { ...adminAuth, query },
    ).then((r) => ({
      rows: r.data,
      nextCursor: (r.meta?.nextCursor as string | null | undefined) ?? null,
      totals: (r.meta?.totals as import("@/features/leasing/settlements/types").SettlementPaymentPage["totals"]) ?? {
        count: r.data.length,
        amount: 0,
      },
    })),

  confirmLeasingBankPayment: (id: string) =>
    request<{ ok: boolean }>(`/admin/leasing-settlements/payments/${id}/confirm`, {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  rejectLeasingBankPayment: (id: string, reason: string) =>
    request<{ ok: boolean }>(`/admin/leasing-settlements/payments/${id}/reject`, {
      ...adminAuth,
      method: "POST",
      body: { reason },
    }).then((r) => r.data),

  unpaidReadyHolds: () =>
    request<{
      unpaidCancelHours: number;
      count: number;
      reservedQty: number;
      consumedOrLegacyQty: number;
      rows: { code: string; name: string; qty: number; stockHold: string; createdAt: string }[];
    }>("/admin/leasing-settlements/unpaid-ready-holds", adminAuth).then((r) => r.data),

  moneyExceptions: () =>
    request<{
      id: string;
      kind: string;
      orderId: string | null;
      settlementPaymentId: string | null;
      qpayInvoiceId: string | null;
      reference: string | null;
      amount: number;
      note: string | null;
      createdAt: string;
    }[]>(
      "/admin/leasing-settlements/exceptions",
      adminAuth,
    ).then((r) => r.data),

  missingSettlementOwners: () =>
    request<{
      orderCount: number;
      amount: number;
      orders: {
        id: string;
        code: string;
        customerName: string;
        confirmedAt: string | null;
        amount: number;
        itemCount: number;
        paidAmount: number;
        recordedMissing: boolean;
      }[];
    }>("/admin/leasing-settlements/missing-owners", adminAuth).then((r) => r.data),

  assignMissingSettlementOwners: (body: { ownerAdminId: string; orderIds: string[] }) =>
    request<{ created: number; orders: number }>("/admin/leasing-settlements/missing-owners/assign", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),
};
