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

  leasingSettlements: (query?: { day?: string; ownerAdminId?: string; status?: string; q?: string }) =>
    request<
      {
        id: string;
        ownerAdminId: string | null;
        orderCode: string;
        customerName: string;
        productName: string;
        qty: number;
        amount: number;
        paidAmount: number;
        remainingAmount: number;
        status: string;
        statusLabel: string;
        confirmedAt: string;
      }[]
    >("/admin/leasing-settlements/settlements", { ...adminAuth, query }).then((r) => r.data),

  leasingSettlementSummary: (query?: { day?: string; ownerAdminId?: string }) =>
    request<{
      day: string;
      orderCount: number;
      amount: number;
      paidAmount: number;
      remainingAmount: number;
      priorUnpaidAmount: number;
      unassignedOrderCount: number;
      unassignedAmount: number;
      lines: {
        id: string;
        orderCode: string;
        customerName: string;
        productName: string;
        qty: number;
        amount: number;
        status: string;
        statusLabel: string;
        remainingAmount: number;
      }[];
    }>("/admin/leasing-settlements/summary", { ...adminAuth, query }).then((r) => r.data),

  leasingSettlementPayments: (query?: { status?: string; ownerAdminId?: string }) =>
    request<
      {
        id: string;
        method: string;
        amount: number;
        status: string;
        bankRef: string | null;
        bankDate: string | null;
        receiptUrl: string | null;
        createdAt: string;
        rejectedReason: string | null;
        lines: { amount: number; settlement: { orderCode: string; productName: string } }[];
      }[]
    >("/admin/leasing-settlements/payments", { ...adminAuth, query }).then((r) => r.data),

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
    request<{ id: string; kind: string; amount: number; note: string | null; createdAt: string }[]>(
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
