import { adminAuth, request, uploadBinary, type Query } from "@/lib/api/client";
import type {
  AdminCustomer,
  AdminOrderDetail,
  AdminOrderQpay,
  AdminOrderRow,
  AdminProduct,
  AdminRound,
  AdminCategory,
  LeasingSettings,
  OrderTotals,
  Payment,
  PaymentLedger,
  PaymentMethod,
  QpayCheckResult,
  QpayPaymentRow,
} from "@/types";

/** Лизингийн админ — зөвхөн /leasing/* URL, admin JWT. */
export const leasingApi = {
  summary: () =>
    request<{
      total: number;
      notArrived: number;
      arrivedUnpaid: number;
      arrivedPaid: number;
      payDueToday: number;
      payOverdue: number;
      resaleCount: number;
    }>("/leasing/orders/summary", adminAuth).then((r) => r.data),

  orders: (query?: Query) =>
    request<AdminOrderRow[]>("/leasing/orders", { ...adminAuth, query }),

  order: (id: string) =>
    request<AdminOrderDetail>(`/leasing/orders/${id}`, adminAuth).then((r) => r.data),

  setOrderStatus: (id: string, status: string, reason?: string, force?: boolean) =>
    request<AdminOrderDetail>(`/leasing/orders/${id}/status`, {
      ...adminAuth,
      method: "PATCH",
      body: { status, reason, force },
    }).then((r) => r.data),

  revertOrderStatus: (id: string, reason?: string) =>
    request<AdminOrderDetail>(`/leasing/orders/${id}/status/revert`, {
      ...adminAuth,
      method: "POST",
      body: reason ? { reason } : {},
    }).then((r) => r.data),

  bulkOrderStatus: (ids: string[], status: string, force?: boolean) =>
    request<{
      requested: number;
      succeeded: number;
      failed: { id: string; code?: string; message: string }[];
      status: string;
    }>("/leasing/orders/bulk-status", {
      ...adminAuth,
      method: "POST",
      body: { ids, status, force },
    }).then((r) => r.data),

  ledger: (orderId: string) =>
    request<PaymentLedger>(`/leasing/orders/${orderId}/payments`, adminAuth).then(
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
      `/leasing/orders/${orderId}/payments`,
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
      `/leasing/orders/${orderId}/payments/refunds`,
      { ...adminAuth, method: "POST", body },
    ).then((r) => r.data),

  cancelOrderItem: (
    orderId: string,
    itemId: string,
    body?: { reason?: string; refund?: boolean },
  ) =>
    request<{ totals: OrderTotals; refunded: number; orderCancelled: boolean }>(
      `/leasing/orders/${orderId}/payments/items/${itemId}/cancel`,
      { ...adminAuth, method: "POST", body: body ?? {} },
    ).then((r) => r.data),

  orderQpay: (orderId: string) =>
    request<AdminOrderQpay>(`/leasing/orders/${orderId}/qpay`, adminAuth).then(
      (r) => r.data,
    ),

  checkOrderQpay: (orderId: string) =>
    request<QpayCheckResult>(`/leasing/orders/${orderId}/qpay/check`, {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  orderQpayPayments: (orderId: string) =>
    request<{ count: number; rows: QpayPaymentRow[] }>(
      `/leasing/orders/${orderId}/qpay/payments`,
      adminAuth,
    ).then((r) => r.data),

  cancelOrderQpayInvoice: (orderId: string) =>
    request<{ invoiceId: string }>(`/leasing/orders/${orderId}/qpay/invoice`, {
      ...adminAuth,
      method: "DELETE",
    }).then((r) => r.data),

  cancelOrderQpayPayment: (orderId: string, paymentId: string) =>
    request<{
      payment: QpayPaymentRow;
      recorded: boolean;
      orderId: string | null;
      orderCode: string | null;
      ledgerError: string | null;
    }>(`/leasing/orders/${orderId}/qpay/payments/${paymentId}/cancel`, {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  refundOrderQpayPayment: (orderId: string, paymentId: string) =>
    request<{
      payment: QpayPaymentRow;
      recorded: boolean;
      orderId: string | null;
      orderCode: string | null;
      ledgerError: string | null;
    }>(`/leasing/orders/${orderId}/qpay/payments/${paymentId}/refund`, {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  customers: (query?: Query) =>
    request<AdminCustomer[]>("/leasing/customers", { ...adminAuth, query }),

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
        orders: AdminOrderRow[];
      }
    >(`/leasing/customers/${id}`, adminAuth).then((r) => r.data),

  updateCustomer: (
    id: string,
    body: Partial<{
      email: string;
      name: string | null;
      phone: string | null;
      district: string | null;
      khoroo: string | null;
      addressText: string | null;
    }>,
  ) =>
    request<AdminCustomer>(`/leasing/customers/${id}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  settings: () =>
    request<LeasingSettings>("/leasing/settings", adminAuth).then((r) => r.data),

  updateSettings: (body: {
    feeTiers?: { minAmount: number; ratePercent: number }[];
    payGaps?: number[];
    choiceHint?: string;
    termsTitle?: string;
    termsBody?: string;
    smsDueToday?: string;
    smsOverdue?: string;
    smsArrivedUnpaid?: string;
    bankName?: string;
    bankAccountNumber?: string;
    bankAccountName?: string;
    paymentNote?: string;
  }) =>
    request<LeasingSettings>("/leasing/settings", {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  previewOrderSms: (id: string) =>
    request<{ text: string; phone: string | null; name: string | null; amount: number }>(
      `/leasing/orders/${id}/sms`,
      adminAuth,
    ).then((r) => r.data),

  sendOrderSms: (id: string, kind: "pay_reminder" = "pay_reminder", text?: string) =>
    request<{ ok: boolean; amount: number }>(`/leasing/orders/${id}/sms`, {
      ...adminAuth,
      method: "POST",
      body: { kind, ...(text != null ? { text } : {}) },
    }).then((r) => r.data),

  sendScheduleSms: (
    kind: "due_today" | "overdue" | "arrived_unpaid",
    orderIds: string[],
    template?: string,
    overrides?: { orderId: string; text: string }[],
  ) =>
    request<{
      sent: number;
      skipped: number;
      failed: { orderId: string; code: string; error: string }[];
    }>("/leasing/orders/sms-reminders", {
      ...adminAuth,
      method: "POST",
      body: {
        kind,
        orderIds,
        ...(template != null ? { template } : {}),
        ...(overrides && overrides.length > 0 ? { overrides } : {}),
      },
    }).then((r) => r.data),

  sendSms: (phones: string | string[], text: string) =>
    request<{
      ok: boolean;
      phone: string;
      sent: number;
      failed: { phone: string; error: string }[];
      invalid: string[];
    }>("/leasing/sms", {
      ...adminAuth,
      method: "POST",
      body: {
        phones: Array.isArray(phones) ? phones : [phones],
        text,
      },
    }).then((r) => r.data),

  products: (query?: Query) =>
    request<AdminProduct[]>("/leasing/products", { ...adminAuth, query }),

  product: (id: string) =>
    request<AdminProduct>(`/leasing/products/${id}`, adminAuth).then((r) => r.data),

  createProduct: (body: unknown) =>
    request<AdminProduct>("/leasing/products", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  updateProduct: (id: string, body: unknown) =>
    request<AdminProduct>(`/leasing/products/${id}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  updateRound: (id: string, body: unknown) =>
    request<AdminRound>(`/leasing/products/rounds/${id}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  categories: () =>
    request<AdminCategory[]>("/leasing/products/categories", adminAuth).then((r) => r.data),

  uploadImage: (id: string, file: Blob) =>
    uploadBinary<{ publicUrl: string; key: string }>(
      `/leasing/products/${id}/images/upload`,
      file,
    ).then((r) => r.data),

  saveImages: (id: string, images: string[]) =>
    request<{ images: string[] }>(`/leasing/products/${id}/images`, {
      ...adminAuth,
      method: "PATCH",
      body: { images },
    }).then((r) => r.data),

  readyTransfer: (orderId: string) =>
    request<{
      isLeasing: boolean;
      netPaid: number;
      dueAmount: number;
      writtenOffAmount: number;
      debtClosedAt: string | null;
      items: {
        id: string;
        name: string;
        qty: number;
        availableQty: number;
        eligible: boolean;
        reason: string | null;
        unitPrice: number;
        selections: Record<string, string>;
        cancelled: boolean;
        handedOver: boolean;
        transferred: boolean;
      }[];
      transfers: {
        id: string;
        reason: string;
        paidKeptAmount: number;
        dueClosedAmount: number;
        wroteOffDebt: boolean;
        remainingActiveQty: number;
        createdAt: string;
      }[];
    }>(`/leasing/orders/${orderId}/ready-transfer`, adminAuth).then((r) => r.data),

  previewReadyTransfer: (
    orderId: string,
    body: {
      reason: string;
      lines: { orderItemId: string; qty: number; resaleUnitPrice: number }[];
    },
  ) =>
    request<{
      code: string;
      netPaid: number;
      paidKeptAmount: number;
      remainingActiveQty: number;
      remainingSubtotal: number;
      dueAfterTransfer: number;
      closeDebt: boolean;
      writeOffAmount: number;
      refund: boolean;
      notice: string;
      reason: string;
      lines: {
        orderItemId: string;
        name: string;
        qty: number;
        unitPrice: number;
        resaleUnitPrice: number;
        selections: Record<string, string>;
        lineTotal: number;
      }[];
    }>(`/leasing/orders/${orderId}/ready-transfer/preview`, {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  confirmReadyTransfer: (
    orderId: string,
    body: {
      reason: string;
      lines: { orderItemId: string; qty: number; resaleUnitPrice: number }[];
    },
  ) =>
    request<{
      transferId: string;
      destRoundIds: string[];
      order: AdminOrderDetail;
    }>(`/leasing/orders/${orderId}/ready-transfer`, {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),
};
