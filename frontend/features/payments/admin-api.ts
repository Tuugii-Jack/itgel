import { adminAuth, request } from "@/lib/api/client";
import type { AdminOrderQpay, AdminQpayStatus, QpayCheckResult, QpayPaymentRow } from "@/types";

export const adminPaymentsApi = {
  // --- QPay (админ, гараар) ---

  qpayStatus: () =>
    request<AdminQpayStatus>("/admin/qpay", adminAuth).then((r) => r.data),

  orderQpay: (orderId: string) =>
    request<AdminOrderQpay>(`/admin/orders/${orderId}/qpay`, adminAuth).then(
      (r) => r.data,
    ),

  checkOrderQpay: (orderId: string) =>
    request<QpayCheckResult>(`/admin/orders/${orderId}/qpay/check`, {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  orderQpayPayments: (orderId: string) =>
    request<{ count: number; rows: QpayPaymentRow[] }>(
      `/admin/orders/${orderId}/qpay/payments`,
      adminAuth,
    ).then((r) => r.data),

  cancelOrderQpayInvoice: (orderId: string) =>
    request<{ invoiceId: string }>(`/admin/orders/${orderId}/qpay/invoice`, {
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
    }>(`/admin/orders/${orderId}/qpay/payments/${paymentId}/cancel`, {
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
    }>(`/admin/orders/${orderId}/qpay/payments/${paymentId}/refund`, {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  qpayPayment: (paymentId: string) =>
    request<QpayPaymentRow>(`/admin/qpay/payments/${paymentId}`, adminAuth).then(
      (r) => r.data,
    ),

  cancelQpayPayment: (paymentId: string) =>
    request<{
      payment: QpayPaymentRow;
      recorded: boolean;
      orderId: string | null;
      orderCode: string | null;
      ledgerError: string | null;
    }>(`/admin/qpay/payments/${paymentId}/cancel`, {
      ...adminAuth,
      method: "DELETE",
    }).then((r) => r.data),

  refundQpayPayment: (paymentId: string) =>
    request<{
      payment: QpayPaymentRow;
      recorded: boolean;
      orderId: string | null;
      orderCode: string | null;
      ledgerError: string | null;
    }>(`/admin/qpay/payments/${paymentId}/refund`, {
      ...adminAuth,
      method: "DELETE",
    }).then((r) => r.data),

  checkQpayInvoice: (invoiceId: string) =>
    request<
      QpayCheckResult & {
        recorded: boolean;
        orderId: string | null;
        orderCode: string | null;
      }
    >("/admin/qpay/payments/check", {
      ...adminAuth,
      method: "POST",
      body: { invoiceId },
    }).then((r) => r.data),

  listQpayPayments: (body: {
    objectType?: string;
    objectId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageLimit?: number;
  }) =>
    request<{ count: number; rows: QpayPaymentRow[] }>("/admin/qpay/payments/list", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  cancelQpayInvoiceById: (invoiceId: string) =>
    request<{ invoiceId: string; orderId: string | null; orderCode: string | null }>(
      `/admin/qpay/invoices/${invoiceId}`,
      { ...adminAuth, method: "DELETE" },
    ).then((r) => r.data),
};
