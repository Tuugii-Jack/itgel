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
};
