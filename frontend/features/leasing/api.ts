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
    publicName?: string;
    contactPhone?: string;
    chatUrl?: string;
  }) =>
    request<LeasingSettings>("/leasing/settings", {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),

  previewOrderSms: (id: string, text?: string) =>
    text
      ? request<{
          text: string;
          phone: string | null;
          name: string | null;
          amount: number;
          previewToken: string;
          chars?: number;
          segments?: number;
        }>(`/leasing/orders/${id}/sms/preview`, {
          ...adminAuth,
          method: "POST",
          body: { text },
        }).then((r) => r.data)
      : request<{
          text: string;
          phone: string | null;
          name: string | null;
          amount: number;
          previewToken: string;
          chars?: number;
          segments?: number;
        }>(`/leasing/orders/${id}/sms`, adminAuth).then((r) => r.data),

  sendOrderSms: (id: string, kind: "pay_reminder" = "pay_reminder", text?: string, previewToken?: string, sendKey?: string) =>
    request<{ ok: boolean; amount: number; smsStatus?: string }>(`/leasing/orders/${id}/sms`, {
      ...adminAuth,
      method: "POST",
      body: { kind, ...(text != null ? { text } : {}), previewToken, sendKey },
    }).then((r) => r.data),

  previewScheduleSms: (
    kind: "due_today" | "overdue" | "arrived_unpaid",
    orderIds: string[],
    template?: string,
    overrides?: { orderId: string; text: string }[],
  ) =>
    request<{
      sender: string | null;
      recipients: { orderId: string; code: string; name: string | null; phone: string; text: string; chars: number; segments: number }[];
      skipped: { orderId: string; code: string; reason: string }[];
      failed: { orderId: string; code: string; error: string }[];
      previewToken: string;
    }>("/leasing/orders/sms-reminders/preview", {
      ...adminAuth,
      method: "POST",
      body: {
        kind,
        orderIds,
        ...(template != null ? { template } : {}),
        ...(overrides && overrides.length > 0 ? { overrides } : {}),
      },
    }).then((r) => r.data),

  sendScheduleSms: (
    kind: "due_today" | "overdue" | "arrived_unpaid",
    orderIds: string[],
    template?: string,
    overrides?: { orderId: string; text: string }[],
    previewToken?: string,
    sendKey?: string,
  ) =>
    request<{
      sent: number;
      skipped: number;
      pending?: number;
      delivered?: number;
      unknown?: number;
      failed: { orderId: string; code: string; error: string }[];
    }>("/leasing/orders/sms-reminders", {
      ...adminAuth,
      method: "POST",
      body: {
        kind,
        orderIds,
        ...(template != null ? { template } : {}),
        ...(overrides && overrides.length > 0 ? { overrides } : {}),
        previewToken,
        sendKey,
      },
    }).then((r) => r.data),

  todayWork: () =>
    request<{ day: string; cards: import("@/features/work/TodayWorkBoard").TodayCard[] }>(
      "/leasing/work/today",
      adminAuth,
    ).then((r) => r.data),

  todayWorkRows: (query: { card: string; day?: string; page?: number }) =>
    request<{
      id: string;
      code?: string;
      amount?: number;
      label?: string;
      href?: string;
      at?: string | null;
      purpose?: string;
      status?: string;
      error?: string;
      createdAt?: string;
    }[]>("/leasing/work/today", { ...adminAuth, query }).then((r) => ({
      data: r.data,
      meta: r.meta as { total: number; page: number; pageSize: number; pages: number },
    })),

  previewSms: (phones: string | string[], text: string) =>
    request<{
      sender: string | null;
      text: string;
      chars: number;
      segments: number;
      phones: string[];
      invalid: string[];
      previewToken: string;
    }>("/leasing/sms/preview", {
      ...adminAuth,
      method: "POST",
      body: { phones: Array.isArray(phones) ? phones : [phones], text },
    }).then((r) => r.data),

  sendSms: (phones: string | string[], text: string, previewToken?: string, sendKey?: string) =>
    request<{
      ok: boolean;
      phone: string;
      sent: number;
      pending?: number;
      delivered?: number;
      unknown?: number;
      failed: { phone: string; error: string }[];
      invalid: string[];
    }>("/leasing/sms", {
      ...adminAuth,
      method: "POST",
      body: {
        phones: Array.isArray(phones) ? phones : [phones],
        text,
        previewToken,
        sendKey,
      },
    }).then((r) => r.data),

  products: (query?: Query) =>
    request<AdminProduct[]>("/leasing/products", { ...adminAuth, query }),

  product: (id: string) =>
    request<AdminProduct>(`/leasing/products/${id}`, adminAuth).then((r) => r.data),

  productOwners: () =>
    request<{ id: string; name: string; email: string }[]>("/leasing/products/owners", adminAuth).then(
      (r) => r.data,
    ),

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

  readyStock: () =>
    request<{ onHand: number; reserved: number; available: number; roundCount: number }>(
      "/leasing/finance/ready/stock",
      adminAuth,
    ).then((r) => r.data),

  readySales: (query?: Query) =>
    request<{
      totals: {
        received: number;
        refunded: number;
        net: number;
        receivable: number;
        unallocatedPaid: number;
        unallocatedRefunded: number;
      };
      rows: {
        id: string;
        code: string;
        status: string;
        createdAt: string;
        customer: { id: string; name: string; phone: string | null };
        items: { id: string; name: string; qty: number; unitPrice: number; total: number; cancelled: boolean }[];
        paidAmount: number;
        refundedAmount: number;
        dueAmount: number;
        unallocatedPaid: number;
        unallocatedRefunded: number;
        attributedMoney: boolean;
        mixedOwnership: boolean;
        paymentState: string;
        sourceTransfer: { id: string; sourceOrderId: string; paidKeptAmount: number } | null;
      }[];
    }>("/leasing/finance/ready/sales", { ...adminAuth, query }).then((r) => r.data),

  itgelSummary: (query?: { day?: string; ownerAdminId?: string }) =>
    request<import("./settlements/types").SettlementSummary>("/leasing/finance/itgel/summary", {
      ...adminAuth,
      query,
    }).then((r) => r.data),

  itgelOperators: () =>
    request<import("./settlements/types").SettlementOperator[]>("/leasing/finance/itgel/operators", adminAuth).then(
      (r) => r.data,
    ),

  itgelSettlements: (query?: {
    from?: string;
    to?: string;
    status?: string;
    q?: string;
    remaining?: string;
    ownerAdminId?: string;
    cursor?: string;
    take?: number;
  }) =>
    request<import("./settlements/types").SettlementLine[]>("/leasing/finance/itgel/settlements", {
      ...adminAuth,
      query,
    }).then((r) => ({
      rows: r.data,
      nextCursor: (r.meta?.nextCursor as string | null | undefined) ?? null,
      totals: (r.meta?.totals as import("./settlements/types").SettlementListPage["totals"]) ?? {
        count: r.data.length,
        remainingAmount: 0,
        amount: 0,
        paidAmount: 0,
      },
    })),

  itgelPreview: (body: {
    settlementIds: string[];
    amount?: number;
    allocations?: { settlementId: string; amount: number }[];
    ownerAdminId?: string;
  }) =>
    request<import("./settlements/types").SettlementPreview>("/leasing/finance/itgel/preview", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  itgelPay: (body: {
    settlementIds: string[];
    method: "QPAY" | "BANK_TRANSFER";
    amount?: number;
    allocations?: { settlementId: string; amount: number }[];
    ownerAdminId?: string;
    bankRef?: string;
    bankDate?: string;
    receiptUrl?: string;
    note?: string;
  }) =>
    request<import("./settlements/types").SettlementPayResult>("/leasing/finance/itgel/pay", {
      ...adminAuth,
      method: "POST",
      body,
    }).then((r) => r.data),

  itgelPending: (ownerAdminId?: string) =>
    request<import("./settlements/types").SettlementPayment[]>("/leasing/finance/itgel/pending", {
      ...adminAuth,
      query: ownerAdminId ? { ownerAdminId } : undefined,
    }).then((r) => r.data),

  itgelResume: (id: string) =>
    request<import("./settlements/types").SettlementPayResult>(`/leasing/finance/itgel/payments/${id}/resume`, {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  itgelVerify: (id: string) =>
    request<{ id: string; status: string; amount: number }>(`/leasing/finance/itgel/payments/${id}/verify`, {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  itgelCancel: (id: string) =>
    request<{ ok: boolean }>(`/leasing/finance/itgel/payments/${id}/cancel`, {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  itgelPayments: (query?: {
    status?: string;
    from?: string;
    to?: string;
    ownerAdminId?: string;
    cursor?: string;
    take?: number;
  }) =>
    request<import("./settlements/types").SettlementPayment[]>("/leasing/finance/itgel/payments", {
      ...adminAuth,
      query,
    }).then((r) => ({
      rows: r.data,
      nextCursor: (r.meta?.nextCursor as string | null | undefined) ?? null,
      totals: (r.meta?.totals as import("./settlements/types").SettlementPaymentPage["totals"]) ?? {
        count: r.data.length,
        amount: 0,
      },
    })),
};
