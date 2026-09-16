import { request } from "@/lib/api/client";
import type { CreatedOrder, PublicOrder, QpayInvoice } from "@/types";

export const shopOrdersApi = {
  createOrder: (
    body: {
      name?: string;
      note?: string;
      leasing?: boolean;
      items: {
        productId: string;
        qty: number;
        selections?: Record<string, string>;
        size?: string;
        color?: string;
      }[];
    },
    opts?: { idempotencyKey?: string },
  ) =>
    request<CreatedOrder>("/orders", {
      method: "POST",
      body,
      auth: "customer",
      headers: opts?.idempotencyKey
        ? { "Idempotency-Key": opts.idempotencyKey }
        : undefined,
    }).then((r) => r.data),

    order: (code: string) =>
    request<PublicOrder>(`/orders/${code}`, { auth: "customer" }).then(
      (r) => r.data,
    ),

  /**
   * "Мөнгө шилжүүлсэн" гэж мэдэгдэх. Төлбөр орсонд тооцогдохгүй — админ
   * дансаа шалгаад дэвтэрт бүртгэх хүртэл захиалга төлөгдөөгүй хэвээр.
   */
  claimPayment: (code: string) =>
    request<{ code: string; paymentClaimedAt: string | null }>(
      `/orders/${code}/payment-claim`,
      { method: "POST", auth: "customer" },
    ).then((r) => r.data),

  /** Төлөөгүй үед QPay ↔ лизинг солино. */
  setOrderPayMethod: (code: string, body: { leasing: boolean }) =>
    request<{
      isLeasing: boolean;
      leasingFee: number;
      dueAmount: number;
      subtotal: number;
    }>(`/orders/${code}/pay-method`, {
      method: "PATCH",
      auth: "customer",
      body,
    }).then((r) => r.data),

  /** QPay нэхэмжлэл үүсгэх — QR + deeplink. Лизингт `amount`-аар хувааж төлнө. */
  createQpayInvoice: (code: string, body?: { amount?: number }) =>
    request<QpayInvoice>(`/orders/${code}/qpay/invoice`, {
      method: "POST",
      auth: "customer",
      body: body ?? {},
    }).then((r) => r.data),

  /** Манай дэвтэр — QPay-г poll хийхгүй. */
  qpayStatus: (code: string) =>
    request<{ paid: boolean; invoiceId: string | null }>(
      `/orders/${code}/qpay/status`,
      { auth: "customer" },
    ).then((r) => r.data),

  /** Callback-ийн дараа нэг удаа payment/check. */
  qpayVerify: (code: string) =>
    request<{ paid: boolean; paidAmount: number; invoiceId: string | null }>(
      `/orders/${code}/qpay/verify`,
      { method: "POST", auth: "customer" },
    ).then((r) => r.data),

  chooseFulfilment: (
    code: string,
    body: {
      type: "PICKUP" | "DELIVERY";
      payMethod?: "QPAY";
      district?: string;
      khoroo?: string;
      address?: string;
      itemIds: string[];
    },
  ) =>
    request<{
      code: string;
      fulfilment: "PICKUP" | "DELIVERY";
      cargoPayMethod?: "CASH" | "QPAY" | null;
      deliveryFee: number;
      dueAmount: number;
      cargoFee?: number;
      storageFee?: number;
      delivery: PublicOrder["delivery"];
      canChooseFulfilment: boolean;
    }>(`/orders/${code}/fulfilment`, {
      method: "POST",
      body,
      auth: "customer",
    }).then(
      (r) => r.data,
    ),
};
