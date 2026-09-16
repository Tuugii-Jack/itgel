import { adminAuth, request, type Query } from "@/lib/api/client";
import type {
  AdminCustomer,
  AdminOrderDetail,
  AdminOrderRow,
  ArchiveCalendar,
  ArchiveCustomer,
  ArchiveDay,
  ArchiveProduct,
  ArchiveSearch,
  OrderTotals,
  OrdersByProductDate,
  OrdersByProductRow,
  Payment,
  PaymentLedger,
  PaymentMethod,
} from "@/types";

export const adminOrdersApi = {
  orders: (query?: Query) =>
    request<AdminOrderRow[]>("/admin/orders", { ...adminAuth, query }),

  /** Шүүлт/сонголтын дагуу дэлгэрэнгүй захиалга (Excel, хэвлэх). */
  exportOrders: (query?: Query) =>
    request<AdminOrderDetail[]>("/admin/orders/export", {
      ...adminAuth,
      query,
    }),

  ordersByProduct: (query?: Query) =>
    request<OrdersByProductRow[]>("/admin/orders/by-product", {
      ...adminAuth,
      query,
    }),

  ordersByProductDates: (closed?: "all" | "open" | "closed") =>
    request<OrdersByProductDate[]>("/admin/orders/by-product/dates", {
      ...adminAuth,
      query: { closed },
    }).then((r) => r.data),

  order: (id: string) =>
    request<AdminOrderDetail>(`/admin/orders/${id}`, adminAuth).then(
      (r) => r.data,
    ),

  createOrder: (body: {
    customerId?: string;
    email?: string;
    phone?: string;
    name?: string;
    note?: string;
    status?: "NEW" | "CONFIRMED";
    markPaid?: boolean;
    items: {
      productId: string;
      qty: number;
      selections?: Record<string, string>;
      size?: string;
      color?: string;
    }[];
  }) =>
    request<AdminOrderDetail>("/admin/orders", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  setOrderStatus: (
    id: string,
    status: string,
    reason?: string,
    force?: boolean,
  ) =>
    request<AdminOrderDetail>(`/admin/orders/${id}/status`, {
      ...adminAuth,
      method: "PATCH",
      body: { status, reason, force },
    }).then((r) => r.data),

  /** Төлвийг нэг алхам буцаана (санамсаргүй урагшлуулсан үед). */
  revertOrderStatus: (id: string, reason?: string) =>
    request<AdminOrderDetail>(`/admin/orders/${id}/status/revert`, {
      ...adminAuth,
      method: "POST",
      body: reason ? { reason } : {},
    }).then((r) => r.data),

  /** Олон захиалгын төлөв нэг хүсэлтээр. Алдаатайг тусад нь буцаана. */
  bulkOrderStatus: (ids: string[], status: string, force?: boolean) =>
    request<{
      requested: number;
      succeeded: number;
      failed: { id: string; code?: string; message: string }[];
      status: string;
    }>("/admin/orders/bulk-status", {
      ...adminAuth,
      method: "POST",
      body: { ids, status, force },
    }).then((r) => r.data),

  // --- Төлбөрийн дэвтэр ---

  ledger: (orderId: string) =>
    request<PaymentLedger>(`/admin/orders/${orderId}/payments`, adminAuth).then(
      (r) => r.data,
    ),

  recordPayment: (
    orderId: string,
    body: {
      amount: number;
      method?: PaymentMethod;
      reference?: string;
      note?: string;
    },
  ) =>
    request<{ payment: Payment; totals: OrderTotals }>(
      `/admin/orders/${orderId}/payments`,
      { ...adminAuth, method: "POST", body },
    ).then((r) => r.data),

  recordRefund: (
    orderId: string,
    body: {
      amount: number;
      method?: PaymentMethod;
      reference?: string;
      note?: string;
    },
  ) =>
    request<{ payment: Payment; totals: OrderTotals }>(
      `/admin/orders/${orderId}/payments/refunds`,
      { ...adminAuth, method: "POST", body },
    ).then((r) => r.data),

  cancelOrderItem: (
    orderId: string,
    itemId: string,
    body?: { reason?: string; refund?: boolean },
  ) =>
    request<{ totals: OrderTotals; refunded: number; orderCancelled: boolean }>(
      `/admin/orders/${orderId}/payments/items/${itemId}/cancel`,
      { ...adminAuth, method: "POST", body: body ?? {} },
    ).then((r) => r.data),
  customers: (query?: Query) =>
    request<AdminCustomer[]>("/admin/customers", { ...adminAuth, query }),

  customer: (id: string) =>
    request<
      AdminCustomer & {
        stats: {
          orderCount: number;
          totalSpent: number;
          handedOver: number;
          cancelled: number;
          lastOrderAt: string | null;
        };
        orders: (AdminOrderRow & { items: unknown[] })[];
      }
    >(`/admin/customers/${id}`, adminAuth).then((r) => r.data),

  createCustomer: (body: {
    email: string;
    name?: string | null;
    phone?: string | null;
    password?: string;
    emailVerified?: boolean;
  }) =>
    request<AdminCustomer>("/admin/customers", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  updateCustomer: (
    id: string,
    body: Partial<{
      email: string;
      name: string | null;
      phone: string | null;
      password: string;
      emailVerified: boolean;
      district: string | null;
      khoroo: string | null;
      addressText: string | null;
      notifyPayment: boolean;
      notifyArrival: boolean;
      notifyPromo: boolean;
      bankName: string | null;
      bankAccountNumber: string | null;
      bankAccountName: string | null;
    }>,
  ) =>
    request<AdminCustomer>(`/admin/customers/${id}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),
  archiveCalendar: (year: number, month: number) =>
    request<ArchiveCalendar>("/admin/archive/calendar", {
      ...adminAuth,
      query: { year, month },
    }).then((r) => r.data),

  archiveDay: (date: string) =>
    request<ArchiveDay>("/admin/archive/day", {
      ...adminAuth,
      query: { date },
    }).then((r) => r.data),

  archiveProduct: (productId: string) =>
    request<ArchiveProduct>(
      `/admin/archive/product/${productId}`,
      adminAuth,
    ).then((r) => r.data),

  archiveCustomer: (customerId: string) =>
    request<ArchiveCustomer>(
      `/admin/archive/customer/${customerId}`,
      adminAuth,
    ).then((r) => r.data),

  archiveSearch: (q: string) =>
    request<ArchiveSearch>("/admin/archive/search", {
      ...adminAuth,
      query: { q },
    }).then((r) => r.data),
};
