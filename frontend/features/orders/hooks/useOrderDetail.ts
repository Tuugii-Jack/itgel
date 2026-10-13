"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useOnKeyChange } from "@/lib/syncKey";
import { useCallback, useEffect, useRef, useState } from "react";
import { ORDER_STATUS_LABEL } from "@/components/admin/shared";
import { adminApi, ApiError, leasingApi } from "@/lib/api";
import { isFullAdmin } from "@/lib/admin-role";
import { useAdminSession } from "@/lib/admin-session";
import { downloadOrdersExcel, printOrders, type OrderExportSelection } from "@/lib/orderExport";
import { hasCustomizedSms, markCustomizedSms, smsTextsEqual } from "@/lib/smsEditOnce";
import { smsStatusLabel } from "@/lib/smsStatus";
import { useToast } from "@/lib/toast";
import type {
  AdminOrderDetail,
  AdminOrderQpay,
  OrderStatus,
  PaymentLedger,
} from "@/lib/types";

export type OrderWorkspaceApi = {
  order: typeof adminApi.order;
  ledger: typeof adminApi.ledger;
  orderQpay: typeof adminApi.orderQpay;
  setOrderStatus: typeof adminApi.setOrderStatus;
  revertOrderStatus: typeof adminApi.revertOrderStatus;
  cancelOrderItem: typeof adminApi.cancelOrderItem;
  recordPayment: typeof adminApi.recordPayment;
  recordRefund: typeof adminApi.recordRefund;
  checkOrderQpay: typeof adminApi.checkOrderQpay;
  orderQpayPayments: typeof adminApi.orderQpayPayments;
  cancelOrderQpayInvoice: typeof adminApi.cancelOrderQpayInvoice;
  cancelOrderQpayPayment: typeof adminApi.cancelOrderQpayPayment;
  refundOrderQpayPayment: typeof adminApi.refundOrderQpayPayment;
};

export function useOrderDetail({
  orderId,
  onChanged,
  api,
  canWrite: canWriteProp,
  workspace: workspaceProp,
}: {
  orderId: string;
  onChanged: () => void;
  api: OrderWorkspaceApi;
  canWrite?: boolean;
  workspace?: "shop" | "leasing";
}) {
  const loadGen = useRef(0);
  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [ledger, setLedger] = useState<PaymentLedger | null>(null);
  const [qpay, setQpay] = useState<AdminOrderQpay | null>(null);
  const [qpayLoading, setQpayLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  /** Аль үйлдэл явж байгааг заана — зөвхөн тухайн товч spinner-тэй харагдана. */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { user } = useAdminSession();
  const workspace = workspaceProp ?? "shop";
  const canWrite = canWriteProp ?? isFullAdmin(user?.role);
  const leasingPortal = workspace === "leasing";
  /** Зөвхөн лизингээр авсан захиалга — QPay захиалгад төлбөр бүртгэх хэвээр. */
  const leasingOrder = order?.isLeasing === true;
  const lockShopPayments = !leasingPortal && leasingOrder;
  const mixedLegacyLocked = order?.mixedOwnership === true && user?.role !== "OWNER";
  const canWritePayments = canWrite && !lockShopPayments && !mixedLegacyLocked;
  const canWriteStatus = canWrite && (!leasingPortal || order?.isResale === true) && !mixedLegacyLocked;
  const canCancelItems = canWrite && !leasingPortal && !lockShopPayments;
  const busy = busyKey !== null;
  /** Төлбөр дутуу гэж 409 өгсөн үед force-оор давах саналыг харуулна. */
  const [shortfall, setShortfall] = useState<{ status: OrderStatus; missing: number } | null>(
    null,
  );
  const [exportOpen, setExportOpen] = useState<"print" | "excel" | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsDefault, setSmsDefault] = useState("");
  const [smsToken, setSmsToken] = useState<string | null>(null);
  const [smsTick, setSmsTick] = useState(0);

  const load = useCallback(async (background = false) => {
    const gen = ++loadGen.current;
    if (!background) setLoading(true);
    setError(null);
    setQpay(null);
    setQpayLoading(true);
    // Invoice metadata must not block the order and its authoritative ledger.
    void api.orderQpay(orderId).then((value) => {
      if (gen === loadGen.current) setQpay(value);
    }).catch(() => undefined).finally(() => {
      if (gen === loadGen.current) setQpayLoading(false);
    });
    try {
      const [o, l] = await Promise.all([
        api.order(orderId),
        api.ledger(orderId),
      ]);
      if (gen !== loadGen.current) return;
      setOrder(o);
      setLedger(l);
    } catch (e) {
      if (gen !== loadGen.current) return;
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [orderId, api]);

  useEffect(() => {
    const requests = loadGen;
    const cancel = deferEffect(() => { void load(); });
    return () => { cancel(); requests.current++; };
  }, [load]);

  useOnKeyChange(orderId, () => {
    setSmsOpen(false);
    setSmsDefault("");
    setSmsToken(null);
  });

  const run = async (key: string, action: () => Promise<unknown>, okMessage: string) => {
    setBusyKey(key);
    setError(null);
    setShortfall(null);
    try {
      await action();
      toast.success(okMessage);
      await load(true);
      onChanged();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Гүйцэтгэж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  };

  const openPaySms = async () => {
    if (!order) return;
    setError(null);
    setBusyKey("leasing-sms");
    try {
      const preview = await leasingApi.previewOrderSms(order.id);
      setSmsDefault(preview.text);
      setSmsToken(preview.previewToken);
      setSmsOpen(true);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Урьдчилан харах боломжгүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  };

  const sendPaySms = async (text: string) => {
    if (!order) return;
    const canEdit = !hasCustomizedSms(order.customer.id);
    const custom = canEdit && !smsTextsEqual(text, smsDefault);
    setBusyKey("leasing-sms");
    setError(null);
    try {
      const preview = custom
        ? await leasingApi.previewOrderSms(order.id, text)
        : { previewToken: smsToken, text };
      if (!preview.previewToken) throw new Error("Preview token алга.");
      const result = await leasingApi.sendOrderSms(
        order.id,
        "pay_reminder",
        custom ? preview.text : undefined,
        preview.previewToken,
        crypto.randomUUID(),
      );
      if (custom) {
        markCustomizedSms(order.customer.id);
        setSmsTick((n) => n + 1);
      }
      toast.success(smsStatusLabel(result.smsStatus ?? "queued"));
      setSmsOpen(false);
      void load(true);
      onChanged();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "SMS илгээгдсэнгүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  };

  const changeStatus = async (status: OrderStatus, force?: boolean) => {
    setBusyKey(`status:${status}`);
    setError(null);
    setShortfall(null);
    try {
      await api.setOrderStatus(orderId, status, undefined, force);
      toast.success(`Төлөв «${ORDER_STATUS_LABEL[status]}» боллоо.`);
      await load();
      onChanged();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        toast.error(e.message);
        const missing = (e.details as { missing?: number } | undefined)?.missing;
        if (e.status === 409 && typeof missing === "number" && missing > 0) {
          setShortfall({ status, missing });
        }
      } else {
        const message = "Гүйцэтгэж чадсангүй.";
        setError(message);
        toast.error(message);
      }
    } finally {
      setBusyKey(null);
    }
  };

  const revertStatus = async () => {
    setBusyKey("status:revert");
    setError(null);
    setShortfall(null);
    try {
      await api.revertOrderStatus(orderId);
      toast.success("Төлөв нэг алхам буцаагдлаа.");
      await load();
      onChanged();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Гүйцэтгэж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  };

  const runLocalExport = (mode: "print" | "excel", columns: OrderExportSelection) => {
    if (!order) return;
    try {
      setExportBusy(true);
      if (mode === "excel") {
        downloadOrdersExcel([order], `${order.code}.csv`, columns);
        toast.success("Excel татагдлаа.");
      } else {
        printOrders([order], columns);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Экспорт хийж чадсангүй.");
    } finally {
      setExportBusy(false);
    }
  };

  return {
    order,
    ledger,
    qpay,
    qpayLoading,
    loading,
    busyKey,
    busy,
    error,
    workspace,
    canWrite,
    leasingPortal,
    leasingOrder,
    lockShopPayments,
    canWritePayments,
    canWriteStatus,
    canCancelItems,
    shortfall,
    setShortfall,
    exportOpen,
    setExportOpen,
    exportBusy,
    smsOpen,
    setSmsOpen,
    smsDefault,
    smsTick,
    load,
    run,
    openPaySms,
    sendPaySms,
    changeStatus,
    revertStatus,
    runLocalExport,
  };
}
