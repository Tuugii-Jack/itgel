"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Metric, PageHead, Select } from "@/components/admin/shared";
import { OrderDetail } from "@/components/admin/OrderDetail";
import { Qr } from "@/components/Qr";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Skeleton } from "@/components/ui";
import { adminApi, leasingApi, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { Tone } from "@/components/ui";
import {
  DISPLAY_STATUS_OPTIONS,
  type SettlementDisplayStatus,
  type SettlementInvoice,
  type SettlementLine,
  type SettlementOperator,
  type SettlementPayment,
  type SettlementPreview,
  type SettlementSummary,
} from "./types";
import {
  appendUniqueById,
  historyDateLabel,
  mergeSelectionOnPage,
  mergeSelectionOnReload,
  payRequestFromPreview,
  restoredQpay,
  selectedRemainingTotal,
} from "./selection";

function ubToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ulaanbaatar" }).format(new Date());
}

function statusTone(status: SettlementDisplayStatus): Tone {
  if (status === "PAID") return "ok";
  if (status === "PARTIAL") return "info";
  if (status === "QPAY_PENDING" || status === "BANK_PENDING") return "warn";
  if (status === "VOID") return "neutral";
  return "danger";
}

function mismatchNote(line: SettlementLine) {
  const parts: string[] = [];
  if (line.mismatch.orderMissing) parts.push("эх захиалга олдсонгүй");
  if (line.mismatch.itemMissing) parts.push("барааны мөр олдсонгүй");
  if (line.mismatch.orderCode) parts.push("захиалгын код зөрсөн");
  if (line.mismatch.qty) parts.push("тоо зөрсөн");
  if (line.mismatch.unitPrice) parts.push("анхны үнэ зөрсөн");
  if (line.mismatch.ledger) parts.push("төлсөн/үлдэгдэл нийлбэр зөрсөн");
  return parts.length ? `Snapshot хэвээр. ${parts.join(", ")}.` : null;
}

function groupByOrder(lines: SettlementLine[]) {
  const map = new Map<string, SettlementLine[]>();
  for (const line of lines) {
    const list = map.get(line.orderId) ?? [];
    list.push(line);
    map.set(line.orderId, list);
  }
  return [...map.entries()].map(([orderId, items]) => ({
    orderId,
    orderCode: items[0]!.orderCode,
    customerName: items[0]!.customerName,
    items,
    remaining: items.reduce((sum, row) => sum + row.remainingAmount, 0),
    amount: items.reduce((sum, row) => sum + row.amount, 0),
    paid: items.reduce((sum, row) => sum + row.paidAmount, 0),
  }));
}

export function ItgelWorkspace({
  variant,
  canPay,
  canConfirmBank,
  showOwnerFilter,
  canWriteOrder,
}: {
  variant: "leasing" | "admin";
  canPay: boolean;
  canConfirmBank: boolean;
  showOwnerFilter: boolean;
  canWriteOrder: boolean;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<"unpaid" | "pending" | "history">("unpaid");
  const [day, setDay] = useState(ubToday);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [ownerAdminId, setOwnerAdminId] = useState("");
  const [operators, setOperators] = useState<SettlementOperator[]>([]);
  const [summary, setSummary] = useState<SettlementSummary | null>(null);
  const [lines, setLines] = useState<SettlementLine[]>([]);
  const [listTotals, setListTotals] = useState<{ count: number; remainingAmount: number } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [pending, setPending] = useState<SettlementPayment[]>([]);
  const [history, setHistory] = useState<SettlementPayment[]>([]);
  const [selected, setSelected] = useState<Map<string, { remaining: number; orderId: string }>>(new Map());
  const [collapsedOrders, setCollapsedOrders] = useState<Set<string>>(new Set());
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invoice, setInvoice] = useState<SettlementInvoice | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [invoicePending, setInvoicePending] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [bankRef, setBankRef] = useState("");
  const [bankDate, setBankDate] = useState(ubToday);
  const [receiptUrl, setReceiptUrl] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const ownerQuery = ownerAdminId || undefined;
  const ownerRequired = showOwnerFilter && canPay;
  const canSelectPay = canPay && (!ownerRequired || Boolean(ownerAdminId));

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    try {
      const [dayData, ops] = await Promise.all([
        variant === "leasing"
          ? leasingApi.itgelSummary({ day, ownerAdminId: ownerQuery })
          : adminApi.leasingSettlementSummary({ day, ownerAdminId: ownerQuery }),
        showOwnerFilter
          ? variant === "leasing"
            ? leasingApi.itgelOperators()
            : adminApi.leasingSettlementOperators()
          : Promise.resolve([] as SettlementOperator[]),
      ]);
      setSummary(dayData);
      setOperators(ops);
      const pendingRows =
        variant === "leasing"
          ? await leasingApi.itgelPending(ownerQuery)
          : (await adminApi.leasingSettlementPayments({ status: "PENDING", ownerAdminId: ownerQuery })).rows;
      setPending(pendingRows);

      if (tab === "unpaid") {
        const page =
          variant === "leasing"
            ? await leasingApi.itgelSettlements({
                from: from || undefined,
                to: to || undefined,
                status: status || undefined,
                q: q || undefined,
                remaining: "1",
                ownerAdminId: ownerQuery,
              })
            : await adminApi.leasingSettlements({
                from: from || undefined,
                to: to || undefined,
                status: status || undefined,
                q: q || undefined,
                remaining: "1",
                ownerAdminId: ownerQuery,
              });
        setLines(page.rows);
        setNextCursor(page.nextCursor);
        setListTotals({ count: page.totals.count, remainingAmount: page.totals.remainingAmount });
        setSelected((prev) => mergeSelectionOnReload(prev, page.rows));
      } else if (tab === "history") {
        const page =
          variant === "leasing"
            ? await leasingApi.itgelPayments({
                status: "CONFIRMED",
                from: from || undefined,
                to: to || undefined,
                ownerAdminId: ownerQuery,
              })
            : await adminApi.leasingSettlementPayments({
                status: "CONFIRMED",
                from: from || undefined,
                to: to || undefined,
                ownerAdminId: ownerQuery,
              });
        setHistory(page.rows);
        setHistoryCursor(page.nextCursor);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [variant, day, from, to, q, status, ownerQuery, tab, showOwnerFilter]);

  useEffect(() => deferEffect(() => { void load(); }), [load]);

  const restoredPendingQpay = restoredQpay(pending);
  const activePaymentId = paymentId ?? restoredPendingQpay?.id ?? null;
  const activeInvoice = invoice ?? restoredPendingQpay?.invoice ?? null;
  const activeInvoicePending = Boolean(
    activePaymentId && !activeInvoice && (invoicePending || restoredPendingQpay?.invoicePending),
  );

  const selectedAmount = selectedRemainingTotal(selected);
  const selectedOrders = new Set([...selected.values()].map((row) => row.orderId)).size;
  const groups = useMemo(() => groupByOrder(lines), [lines]);

  const loadMore = async () => {
    if (!nextCursor || tab !== "unpaid") return;
    setBusy(true);
    try {
      const page =
        variant === "leasing"
          ? await leasingApi.itgelSettlements({
              from: from || undefined,
              to: to || undefined,
              status: status || undefined,
              q: q || undefined,
              remaining: "1",
              ownerAdminId: ownerQuery,
              cursor: nextCursor,
            })
          : await adminApi.leasingSettlements({
              from: from || undefined,
              to: to || undefined,
              status: status || undefined,
              q: q || undefined,
              remaining: "1",
              ownerAdminId: ownerQuery,
              cursor: nextCursor,
            });
      setLines((prev) => appendUniqueById(prev, page.rows));
      setSelected((prev) => mergeSelectionOnPage(prev, page.rows));
      setNextCursor(page.nextCursor);
      setListTotals({ count: page.totals.count, remainingAmount: page.totals.remainingAmount });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Дараагийн мөрийг ачаалж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const loadMoreHistory = async () => {
    if (!historyCursor || tab !== "history") return;
    setBusy(true);
    try {
      const page =
        variant === "leasing"
          ? await leasingApi.itgelPayments({
              status: "CONFIRMED",
              from: from || undefined,
              to: to || undefined,
              ownerAdminId: ownerQuery,
              cursor: historyCursor,
            })
          : await adminApi.leasingSettlementPayments({
              status: "CONFIRMED",
              from: from || undefined,
              to: to || undefined,
              ownerAdminId: ownerQuery,
              cursor: historyCursor,
            });
      setHistory((prev) => appendUniqueById(prev, page.rows));
      setHistoryCursor(page.nextCursor);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Түүхийг ачаалж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const toggleLine = (id: string) => {
    const line = lines.find((row) => row.id === id);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else if (line) next.set(id, { remaining: line.remainingAmount, orderId: line.orderId });
      return next;
    });
  };

  const toggleOrder = (orderId: string, items: SettlementLine[]) => {
    const rows = items.filter((row) => row.selectable);
    setSelected((prev) => {
      const next = new Map(prev);
      const allOn = rows.length > 0 && rows.every((row) => next.has(row.id));
      for (const row of rows) {
        if (allOn) next.delete(row.id);
        else next.set(row.id, { remaining: row.remainingAmount, orderId: row.orderId });
      }
      return next;
    });
  };

  const showInvoice = (result: {
    payment: { id: string };
    invoice: SettlementInvoice | null;
    invoicePending?: boolean;
  }) => {
    setPaymentId(result.payment.id);
    setInvoice(result.invoice);
    setInvoicePending(Boolean(result.invoicePending));
  };

  const pay = async (
    method: "QPAY" | "BANK_TRANSFER",
    amount?: number,
    allocations?: { settlementId: string; amount: number }[],
  ) => {
    const settlementIds = [...selected.keys()];
    if (settlementIds.length === 0) {
      toast.error("Тооцоо сонгоно уу.");
      return;
    }
    if (ownerRequired && !ownerAdminId) {
      toast.error("Эзэн сонгоно уу. Өөр эзний өрийг нэгтгэхгүй.");
      return;
    }
    setBusy(true);
    try {
      const live = await leasingApi.itgelPreview({
        settlementIds,
        amount,
        allocations,
        ownerAdminId: ownerQuery,
      });
      const request = payRequestFromPreview(live);
      const result = await leasingApi.itgelPay({
        ...request,
        method,
        ownerAdminId: ownerQuery,
        bankRef: method === "BANK_TRANSFER" ? bankRef : undefined,
        bankDate: method === "BANK_TRANSFER" ? bankDate : undefined,
        receiptUrl: method === "BANK_TRANSFER" && receiptUrl ? receiptUrl : undefined,
      });
      if (method === "QPAY") {
        showInvoice(result);
        if (result.invoicePending) toast.error("QPay нэхэмжлэл тодорхойгүй. Үргэлжлүүлж хайна; шинээр үүсгэхгүй.");
        else toast.success("QPay нэхэмжлэл бэлэн.");
      } else {
        toast.success("Шилжүүлэг бүртгэгдлээ. Үндсэн админ батална.");
        setBankOpen(false);
      }
      setCustomOpen(false);
      setPreview(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Төлбөр үүсгэж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const openCustom = async () => {
    const amount = Number(customAmount.replace(/[^\d-]/g, ""));
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      toast.error("Бүхэл төгрөгөөр дүн оруулна уу.");
      return;
    }
    const settlementIds = [...selected.keys()];
    if (settlementIds.length === 0) {
      toast.error("Тооцоо сонгоно уу.");
      return;
    }
    setBusy(true);
    try {
      const data = await leasingApi.itgelPreview({
        settlementIds,
        amount,
        ownerAdminId: ownerQuery,
      });
      setPreview(data);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Хуваарилалт харж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (id: string) => {
    setBusy(true);
    try {
      const st = await leasingApi.itgelVerify(id);
      if (st.status === "CONFIRMED") {
        toast.success("Итгэлд төлөгдлөө.");
        setInvoice(null);
        setPaymentId(null);
        setInvoicePending(false);
      } else toast.error("Төлбөр хараахан ороогүй байна.");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Шалгаж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const resume = async (id: string) => {
    setBusy(true);
    try {
      const result = await leasingApi.itgelResume(id);
      showInvoice(result);
      if (result.invoice) toast.success("Нэхэмжлэлийг үргэлжлүүллээ.");
      else toast.error("QPay нэхэмжлэл тодорхойгүй. Жагсаалтаас олдохгүй бол цуцална уу.");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Үргэлжлүүлж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const cancelInvoice = async (id: string) => {
    setBusy(true);
    try {
      await leasingApi.itgelCancel(id);
      toast.success("Нэхэмжлэлийг цуцаллаа.");
      if (paymentId === id) {
        setInvoice(null);
        setPaymentId(null);
        setInvoicePending(false);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Цуцалж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const confirmBank = async (id: string) => {
    setBusy(true);
    try {
      await adminApi.confirmLeasingBankPayment(id);
      toast.success("Шилжүүлгийг баталлаа.");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Баталгаажуулж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const rejectBank = async () => {
    if (!rejectId || rejectReason.trim().length < 3) return;
    setBusy(true);
    try {
      await adminApi.rejectLeasingBankPayment(rejectId, rejectReason.trim());
      toast.success("Буцаалаа.");
      setRejectId(null);
      setRejectReason("");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Буцааж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  if (openOrderId) {
    return (
      <OrderDetail
        orderId={openOrderId}
        api={variant === "leasing" ? leasingApi : adminApi}
        canWrite={canWriteOrder}
        workspace={variant === "leasing" ? "leasing" : "shop"}
        onClose={() => setOpenOrderId(null)}
        onChanged={() => void load()}
      />
    );
  }

  return (
    <div className={canSelectPay && selectedAmount > 0 ? "pb-28" : ""}>
      <PageHead
        title={variant === "leasing" ? "Итгэлд төлөх" : "Лизингийн тооцоо"}
        hint={
          variant === "leasing"
            ? "Хэрэглэгчийн хэсэгчилсэн төлөлт энэ дүнг бууруулахгүй. Өрийг захиалга/барааны мөрөөр харна."
            : "Хэнээс, ямар захиалгад, хэд орсон, хэд үлдсэнийг энд батална. Дансны мэдүүлэг өр хаахгүй."
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["unpaid", "Төлөх үлдэгдэл"],
            ["pending", "Хүлээгдэж буй төлбөр"],
            ["history", "Төлөлтийн түүх"],
          ] as const
        ).map(([id, label]) => (
          <Button key={id} size="sm" variant={tab === id ? "primary" : "outline"} onClick={() => setTab(id)}>
            {label}
          </Button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Өдөр (УБ)
          <Input type="date" value={day} onChange={setDay} className="w-full sm:w-44" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Эхлэх
          <Input type="date" value={from} onChange={setFrom} className="w-full sm:w-44" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Дуусах
          <Input type="date" value={to} onChange={setTo} className="w-full sm:w-44" />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-muted">
          Хайлт
          <Input value={search} onChange={setSearch} placeholder="Захиалга, хэрэглэгч, бараа" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Төлөв
          <Select value={status} onChange={setStatus} options={DISPLAY_STATUS_OPTIONS} className="min-w-44" />
        </label>
        {showOwnerFilter && (
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            Эзэн
            <select
              value={ownerAdminId}
              onChange={(e) => setOwnerAdminId(e.target.value)}
              className="h-11 min-w-44 rounded-[8px] border border-line bg-bg px-3 text-[14px]"
            >
              <option value="">{canPay ? "Эзэн сонгоно уу" : "Бүгд"}</option>
              {operators.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.name}
                  {op.isActive === false ? " · идэвхгүй" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {ownerRequired && !ownerAdminId && (
        <p className="mb-4 mt-0 text-[13px] text-ink-2">Төлөхийн тулд эзэн сонгоно. Өөр эзний өрийг нэг жагсаалтаар нэгтгэхгүй.</p>
      )}

      {loading || !summary ? (
        <Skeleton className="h-40 w-full rounded-[12px]" />
      ) : (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Нийт төлөөгүй үлдэгдэл" value={money(summary.totalUnpaidRemaining)} tone="warn" />
          <Metric
            label="Энэ өдөр үүссэн өр"
            value={money(summary.createdOnDayAmount)}
            sub={`${summary.createdOnDayOrders} захиалга`}
          />
          <Metric
            label="Энэ өдөр баталгаажсан төлбөр"
            value={money(summary.paidOnDayAmount)}
            tone="ok"
            sub={
              summary.paidUnknownCount
                ? `${summary.paidOnDayCount} гүйлгээ · ${summary.paidUnknownCount} огноо тодорхойгүй`
                : `${summary.paidOnDayCount} гүйлгээ`
            }
          />
          <Metric
            label="Дансны баталгаа хүлээж буй"
            value={money(summary.pendingBankAmount)}
            tone="info"
            sub={summary.pendingQpayAmount ? `QPay ${money(summary.pendingQpayAmount)}` : undefined}
          />
        </div>
      )}

      {(activeInvoice || activeInvoicePending) && activePaymentId && (
        <Card className="mb-4 flex flex-col items-center gap-3 p-4">
          <div className="text-[15px] font-medium">
            {activeInvoicePending
              ? "QPay нэхэмжлэл тодорхойгүй. Үргэлжлүүлэх нь хайна, шинээр үүсгэхгүй."
              : `Итгэлд төлөх QPay · ${money(activeInvoice?.amount ?? 0)}`}
          </div>
          {activeInvoice?.qrImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={activeInvoice.qrImage.startsWith("data:") ? activeInvoice.qrImage : `data:image/png;base64,${activeInvoice.qrImage}`}
              alt="QPay"
              width={180}
              height={180}
              className="rounded-[8px] border border-line bg-white p-2"
            />
          ) : activeInvoice?.qrText ? (
            <Qr value={activeInvoice.qrText} size={160} />
          ) : null}
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button variant="outline" loading={busy} onClick={() => void resume(activePaymentId)}>
              Үргэлжлүүлэх
            </Button>
            <Button variant="outline" loading={busy} onClick={() => void verify(activePaymentId)}>
              Төлбөр шалгах
            </Button>
            <Button variant="ghost" loading={busy} onClick={() => void cancelInvoice(activePaymentId)}>
              Нэхэмжлэл цуцлах
            </Button>
          </div>
        </Card>
      )}

      {tab === "unpaid" && (
        <>
          {listTotals && (
            <p className="mb-3 mt-0 text-[13px] text-ink-2">
              Шүүлтэд {listTotals.count} мөр · үлдэгдэл {money(listTotals.remainingAmount)}
            </p>
          )}
          {groups.length === 0 ? (
            <Empty>Төлөх үлдэгдэл алга.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => {
                const selectable = group.items.filter((row) => row.selectable);
                const allOn = selectable.length > 0 && selectable.every((row) => selected.has(row.id));
                const open = !collapsedOrders.has(group.orderId);
                return (
                  <Card key={group.orderId} className="p-3 sm:p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        {canSelectPay && selectable.length > 0 && (
                          <input
                            type="checkbox"
                            className="mt-1 h-5 w-5"
                            checked={allOn}
                            onChange={() => toggleOrder(group.orderId, group.items)}
                            aria-label={`${group.orderCode} сонгох`}
                          />
                        )}
                        <div className="min-w-0">
                          <button
                            type="button"
                            className="cursor-pointer border-0 bg-transparent p-0 text-left text-[15px] font-medium underline"
                            onClick={() => setOpenOrderId(group.orderId)}
                          >
                            {group.orderCode}
                          </button>
                          <div className="text-[13px] text-ink-2">{group.customerName}</div>
                          <div className="mt-1 text-[13px]">
                            Үлдэгдэл <span className="tnum font-medium">{money(group.remaining)}</span>
                            {" · "}
                            орсон {money(group.paid)} / {money(group.amount)}
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setCollapsedOrders((prev) => {
                            const next = new Set(prev);
                            if (next.has(group.orderId)) next.delete(group.orderId);
                            else next.add(group.orderId);
                            return next;
                          })
                        }
                      >
                        {open ? "Хураах" : `Бараа · ${group.items.length}`}
                      </Button>
                    </div>
                    {open && (
                      <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                        {group.items.map((line) => (
                          <div key={line.id} className="flex items-start gap-3 rounded-[8px] bg-surface px-3 py-2">
                            {canSelectPay && line.selectable ? (
                              <input
                                type="checkbox"
                                className="mt-1 h-5 w-5"
                                checked={selected.has(line.id)}
                                onChange={() => toggleLine(line.id)}
                              />
                            ) : (
                              <span className="mt-1 w-5" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{line.productName}</span>
                                <Badge tone={statusTone(line.displayStatus)}>{line.statusLabel}</Badge>
                              </div>
                              {line.sku && <div className="text-[12px] text-ink-2">{line.sku}</div>}
                              <div className="tnum text-[13px] text-ink-2">
                                {line.qty} ш · анх {money(line.unitPrice)} · Итгэлд {money(line.amount)} · төлсөн{" "}
                                {money(line.paidAmount)} · үлдэгдэл {money(line.remainingAmount)}
                              </div>
                              {mismatchNote(line) && (
                                <div className="mt-1 text-[12px] text-warn">{mismatchNote(line)}</div>
                              )}
                              {line.lockedReason && (
                                <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                                  <span className="text-[12px] text-warn">{line.lockedReason}</span>
                                  {line.lockPaymentId && canPay && (
                                    <div className="flex flex-wrap gap-2">
                                      <Button size="sm" variant="outline" onClick={() => void resume(line.lockPaymentId!)}>
                                        Үргэлжлүүлэх
                                      </Button>
                                      <Button size="sm" variant="outline" onClick={() => void verify(line.lockPaymentId!)}>
                                        Шалгах
                                      </Button>
                                      <Button size="sm" variant="ghost" onClick={() => void cancelInvoice(line.lockPaymentId!)}>
                                        Цуцлах
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
          {nextCursor && (
            <Button className="mt-3 min-h-11 w-full sm:w-auto" variant="outline" loading={busy} onClick={() => void loadMore()}>
              Дараагийн мөрүүд
            </Button>
          )}
        </>
      )}

      {tab === "pending" && (
        <>
          {pending.length === 0 ? (
            <Empty>Хүлээгдэж буй төлбөр алга.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {pending.map((p) => (
                <Card key={p.id} className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        {p.method === "QPAY" ? "QPay" : "Данс"} · {money(p.amount)}
                      </div>
                      <div className="text-[13px] text-ink-2">
                        {p.ownerName ? `${p.ownerName} · ` : ""}
                        {p.status}
                        {p.bankRef ? ` · ${p.bankRef}` : ""}
                      </div>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                      {p.method === "QPAY" && canPay && (
                        <>
                          <Button size="sm" variant="outline" loading={busy} onClick={() => void resume(p.id)}>
                            Үргэлжлүүлэх
                          </Button>
                          <Button size="sm" variant="outline" loading={busy} onClick={() => void verify(p.id)}>
                            Төлбөр шалгах
                          </Button>
                          <Button size="sm" variant="ghost" loading={busy} onClick={() => void cancelInvoice(p.id)}>
                            Цуцлах
                          </Button>
                        </>
                      )}
                      {p.method === "BANK_TRANSFER" && canConfirmBank && p.status === "PENDING" && (
                        <>
                          <Button size="sm" loading={busy} onClick={() => void confirmBank(p.id)}>
                            Батлах
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRejectId(p.id);
                              setRejectReason("");
                            }}
                          >
                            Буцаах
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {p.lines.map((line) => (
                    <div key={line.settlement.id} className="text-[13px]">
                      <button
                        type="button"
                        className="cursor-pointer border-0 bg-transparent p-0 underline"
                        onClick={() => setOpenOrderId(line.settlement.orderId)}
                      >
                        {line.settlement.orderCode}
                      </button>
                      {" · "}
                      {line.settlement.customerName} · энэ өрөнд {money(line.amount)}
                      {line.settlement.remainingAmount > 0 ? ` · үлдэгдэл ${money(line.settlement.remainingAmount)}` : ""}
                    </div>
                  ))}
                </Card>
              ))}
            </div>
          )}
          {rejectId && (
            <Card className="mt-4 flex max-w-[480px] flex-col gap-3 p-4">
              <div className="text-[15px] font-medium">Шилжүүлэг буцаах</div>
              <Input value={rejectReason} onChange={setRejectReason} placeholder="Шалтгаан" />
              <div className="flex gap-2">
                <Button loading={busy} disabled={rejectReason.trim().length < 3} onClick={() => void rejectBank()}>
                  Буцаах
                </Button>
                <Button variant="ghost" onClick={() => setRejectId(null)}>
                  Болих
                </Button>
              </div>
            </Card>
          )}
        </>
      )}

      {tab === "history" && (
        <>
          {history.length === 0 ? (
            <Empty>Баталгаажсан төлбөр алга.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {history.map((p) => (
                <Card key={p.id} className="p-4">
                  <div className="font-medium">
                    {p.method === "QPAY" ? "QPay" : "Данс"} · нийт {money(p.amount)}
                  </div>
                  <div className="text-[13px] text-ink-2">
                    {historyDateLabel(p)}
                    {p.ownerName ? ` · ${p.ownerName}` : ""}
                    {p.claimedBy ? ` · ${p.claimedBy}` : ""}
                  </div>
                  {p.lines.map((line) => (
                    <div key={line.settlement.id} className="mt-2 text-[13px]">
                      <button
                        type="button"
                        className="cursor-pointer border-0 bg-transparent p-0 underline"
                        onClick={() => setOpenOrderId(line.settlement.orderId)}
                      >
                        {line.settlement.orderCode}
                      </button>
                      {" · "}
                      {line.settlement.customerName} · {line.settlement.productName}
                      {" · энэ өрөнд "}
                      {money(line.amount)}
                      {" · үлдэгдэл "}
                      {money(line.settlement.remainingAmount)}
                    </div>
                  ))}
                </Card>
              ))}
            </div>
          )}
          {historyCursor && (
            <Button className="mt-3 min-h-11 w-full sm:w-auto" variant="outline" loading={busy} onClick={() => void loadMoreHistory()}>
              Дараагийн түүх
            </Button>
          )}
        </>
      )}

      {canSelectPay && tab === "unpaid" && selectedAmount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg p-3 sm:p-4">
          <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[14px]">
              Сонгосон {selectedOrders} захиалга ·{" "}
              <span className="tnum font-medium">{money(selectedAmount)}</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button loading={busy} className="min-h-11 w-full sm:w-auto" onClick={() => void pay("QPAY")}>
                Бүтэн төлөх
              </Button>
              <Button
                variant="outline"
                className="min-h-11 w-full sm:w-auto"
                onClick={() => {
                  setCustomOpen(true);
                  setCustomAmount(String(selectedAmount));
                  setPreview(null);
                }}
              >
                Дүн оруулж төлөх
              </Button>
              <Button variant="ghost" className="min-h-11 w-full sm:w-auto" onClick={() => setBankOpen(true)}>
                Дансаар мэдэгдэх
              </Button>
            </div>
          </div>
        </div>
      )}

      {customOpen && (
        <Card className="fixed inset-x-3 bottom-24 z-30 flex max-h-[70vh] flex-col gap-3 overflow-auto p-4 sm:inset-auto sm:bottom-24 sm:right-6 sm:w-[420px]">
          <div className="text-[15px] font-medium">Дүн оруулж төлөх</div>
          <Field label="Төгрөг (бүхэл)">
            <Input value={customAmount} onChange={setCustomAmount} inputMode="numeric" />
          </Field>
          <div className="flex gap-2">
            <Button loading={busy} onClick={() => void openCustom()}>
              Хуваарилалт харах
            </Button>
            <Button variant="ghost" onClick={() => setCustomOpen(false)}>
              Болих
            </Button>
          </div>
          {preview && (
            <>
              <div className="text-[13px] text-ink-2">Анхдагч: хамгийн эрт өрөөс. Сонгоогүй өрөнд орохгүй.</div>
              {preview.allocations.map((line) => (
                <div key={line.settlementId} className="text-[13px]">
                  {line.orderCode} · {line.productName}: {money(line.amount)} / үлдэгдэл {money(line.remainingAmount)}
                </div>
              ))}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  loading={busy}
                  onClick={() =>
                    void pay(
                      "QPAY",
                      preview.amount,
                      preview.allocations.map((line) => ({ settlementId: line.settlementId, amount: line.amount })),
                    )
                  }
                >
                  QPay · {money(preview.amount)}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setBankOpen(true);
                  }}
                >
                  Дансаар
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {bankOpen && (
        <Card className="fixed inset-x-3 bottom-24 z-30 flex max-w-[480px] flex-col gap-3 p-4 sm:left-auto sm:right-6">
          <div className="text-[15px] font-medium">Дансаар шилжүүлсэн</div>
          <p className="m-0 text-[13px] text-ink-2">
            Баримт оруулсан төдийд өр хаагдахгүй. Дүн: {money(preview?.amount ?? selectedAmount)}
          </p>
          <Field label="Гүйлгээний лавлагаа">
            <Input value={bankRef} onChange={setBankRef} />
          </Field>
          <Field label="Огноо">
            <Input type="date" value={bankDate} onChange={setBankDate} />
          </Field>
          <Field label="Баримтын холбоос">
            <Input value={receiptUrl} onChange={setReceiptUrl} placeholder="https://" />
          </Field>
          <div className="flex gap-2">
            <Button
              loading={busy}
              disabled={!bankRef.trim()}
              onClick={() =>
                void pay(
                  "BANK_TRANSFER",
                  preview?.amount,
                  preview?.allocations.map((line) => ({ settlementId: line.settlementId, amount: line.amount })),
                )
              }
            >
              Мэдэгдэх
            </Button>
            <Button variant="ghost" onClick={() => setBankOpen(false)}>
              Болих
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
