"use client";
import { SearchField } from "@/components/admin/SearchField";
import { downloadReportCsv } from "@/lib/reportCsv";

import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOnKeyChange } from "@/lib/syncKey";
import { parseMoneyInput } from "@/lib/moneyInput";
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
  type SettlementListPage,
  type SettlementOperator,
  type SettlementPayment,
  type SettlementPaymentPage,
  type SettlementPreview,
  type SettlementSummary,
  type SettlementPaymentOptions,
} from "./types";
import {
  appendUniqueById,
  historyDateLabel,
  mergeSelectionOnPage,
  mergeSelectionOnReload,
  restoredQpay,
  selectedRemainingTotal,
  addSettlementSelection,
  MAX_SETTLEMENT_SELECTION,
  payRequestFromPreview,
} from "./selection";

function ubToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ulaanbaatar" }).format(new Date());
}

const PAYMENT_STATUS_LABEL: Record<string, string> = { PENDING: "Хүлээгдэж буй", CONFIRMED: "Баталгаажсан", REJECTED: "Буцаасан", SUPERSEDED: "Цуцалсан" };

function PaymentEvidence({ payment }: { payment: SettlementPayment }) {
  return <div className="flex flex-col gap-1 text-[13px] text-ink-2">
    {payment.bankDate && <div>Шилжүүлсэн огноо: {payment.bankDate.slice(0, 10)}</div>}
    {payment.receiptUrl && /^https?:\/\//i.test(payment.receiptUrl) && <a href={payment.receiptUrl} target="_blank" rel="noopener noreferrer" className="underline">Шилжүүлгийн баримт нээх</a>}
    {payment.rejectedReason && <div className="text-warn">Буцаасан шалтгаан: {payment.rejectedReason}</div>}
  </div>;
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
  const [historyStatus, setHistoryStatus] = useState("");
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
  const [invoiceCreating, setInvoiceCreating] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [bankRef, setBankRef] = useState("");
  const [bankDate, setBankDate] = useState(ubToday);
  const [receiptUrl, setReceiptUrl] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [paymentOptions, setPaymentOptions] = useState<SettlementPaymentOptions | null>(null);
  const loadGeneration = useRef(0);
  const paymentSubmitting = useRef(false);

  const ownerQuery = ownerAdminId || undefined;
  const ownerRequired = showOwnerFilter && canPay;
  const canSelectPay = canPay && (!ownerRequired || Boolean(ownerAdminId));
  const canBankPay = canSelectPay && paymentOptions?.manualBankAllowed === true;
  const selectionScope = [ownerQuery, from, to, q, status].join("|");
  useOnKeyChange(selectionScope, () => {
    setSelected(new Map()); setPreview(null); setCustomOpen(false); setBankOpen(false);
    setInvoice(null); setPaymentId(null); setInvoicePending(false);
  });
  const selectionKey = [...selected].map(([id, row]) => `${id}:${row.remaining}`).sort().join("|");
  useOnKeyChange(`${selectionKey}|${customAmount}`, () => { setPreview(null); });

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const summaryReq =
        variant === "leasing"
          ? leasingApi.itgelSummary({ day, ownerAdminId: ownerQuery })
          : adminApi.leasingSettlementSummary({ day, ownerAdminId: ownerQuery });
      const opsReq = showOwnerFilter
        ? variant === "leasing"
          ? leasingApi.itgelOperators()
          : adminApi.leasingSettlementOperators()
        : Promise.resolve([] as SettlementOperator[]);
      const pendingReq =
        variant === "leasing"
          ? leasingApi.itgelPending(ownerQuery)
          : adminApi.leasingSettlementPayments({ status: "PENDING", ownerAdminId: ownerQuery }).then((page) => page.rows);
      const unpaidQuery = {
        from: from || undefined,
        to: to || undefined,
        status: status || undefined,
        q: q || undefined,
        remaining: "1" as const,
        ownerAdminId: ownerQuery,
      };
      const historyQuery = {
        status: historyStatus || undefined,
        from: from || undefined,
        to: to || undefined,
        ownerAdminId: ownerQuery,
      };
      const listReq: Promise<SettlementListPage | SettlementPaymentPage | null> =
        tab === "unpaid"
          ? variant === "leasing"
            ? leasingApi.itgelSettlements(unpaidQuery)
            : adminApi.leasingSettlements(unpaidQuery)
          : tab === "history"
            ? variant === "leasing"
              ? leasingApi.itgelPayments(historyQuery)
              : adminApi.leasingSettlementPayments(historyQuery)
            : Promise.resolve(null);

      const [dayData, ops, pendingRows, list] = await Promise.all([summaryReq, opsReq, pendingReq, listReq]);
      if (generation !== loadGeneration.current) return;
      setSummary(dayData);
      setOperators(ops);
      setPending(pendingRows);
      if (tab === "unpaid" && list) {
        const page = list as SettlementListPage;
        setLines(page.rows);
        setNextCursor(page.nextCursor);
        setListTotals({ count: page.totals.count, remainingAmount: page.totals.remainingAmount });
        setSelected((prev) => mergeSelectionOnReload(prev, page.rows));
      } else if (tab === "history" && list) {
        const page = list as SettlementPaymentPage;
        setHistory(page.rows);
        setHistoryCursor(page.nextCursor);
      }
      setError(null);
    } catch (e) {
      if (generation !== loadGeneration.current) return;
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [variant, day, from, to, q, status, historyStatus, ownerQuery, tab, showOwnerFilter]);

  useEffect(() => {
    const requests = loadGeneration;
    const cancel = deferEffect(() => { setLoading(true); void load(); });
    return () => { cancel(); requests.current++; };
  }, [load]);
  useEffect(() => {
    if (!canPay) return;
    let active = true;
    void leasingApi.itgelPaymentOptions().then((options) => { if (active) setPaymentOptions(options); })
      .catch(() => { if (active) setPaymentOptions(null); });
    return () => { active = false; };
  }, [canPay]);

  const restoredPendingQpay = restoredQpay(pending, ownerRequired ? ownerQuery ?? null : undefined);
  const activePaymentId = paymentId ?? restoredPendingQpay?.id ?? null;
  const activeInvoice = invoice ?? restoredPendingQpay?.invoice ?? null;
  const activeInvoicePending = Boolean(
    activePaymentId && !activeInvoice && (invoicePending || restoredPendingQpay?.invoicePending),
  );

  const selectedAmount = selectedRemainingTotal(selected);
  const selectedOrders = new Set([...selected.values()].map((row) => row.orderId)).size;
  const groups = useMemo(() => groupByOrder(lines), [lines]);

  const loadMore = async () => {
    if (!nextCursor || tab !== "unpaid" || busy || loading) return;
    const generation = loadGeneration.current;
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
      if (generation !== loadGeneration.current) return;
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
    if (!historyCursor || tab !== "history" || busy || loading) return;
    const generation = loadGeneration.current;
    setBusy(true);
    try {
      const page =
        variant === "leasing"
          ? await leasingApi.itgelPayments({
              status: historyStatus || undefined,
              from: from || undefined,
              to: to || undefined,
              ownerAdminId: ownerQuery,
              cursor: historyCursor,
            })
          : await adminApi.leasingSettlementPayments({
              status: historyStatus || undefined,
              from: from || undefined,
              to: to || undefined,
              ownerAdminId: ownerQuery,
              cursor: historyCursor,
            });
      if (generation !== loadGeneration.current) return;
      setHistory((prev) => appendUniqueById(prev, page.rows));
      setHistoryCursor(page.nextCursor);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Түүхийг ачаалж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const toggleLine = (id: string) => {
    if (busy || loading) return;
    const line = lines.find((row) => row.id === id);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else if (line) return addSettlementSelection(next, [line]);
      return next;
    });
  };

  const toggleOrder = (orderId: string, items: SettlementLine[]) => {
    if (busy || loading) return;
    const rows = items.filter((row) => row.selectable);
    setSelected((prev) => {
      const next = new Map(prev);
      const allOn = rows.length > 0 && rows.every((row) => next.has(row.id));
      for (const row of rows) {
        if (allOn) next.delete(row.id);
        else return addSettlementSelection(next, rows);
      }
      return next;
    });
  };

  const showInvoice = (result: {
    payment: { id: string; status?: string };
    invoice: SettlementInvoice | null;
    invoicePending?: boolean;
  }) => {
    if (result.payment.status && result.payment.status !== "PENDING") {
      setPaymentId(null); setInvoice(null); setInvoicePending(false); return;
    }
    setPaymentId(result.payment.id);
    setInvoice(result.invoice);
    setInvoicePending(Boolean(result.invoicePending));
  };

  const pay = async (
    method: "QPAY" | "BANK_TRANSFER",
    amount?: number,
    allocations?: { settlementId: string; amount: number }[],
  ) => {
    if (!canSelectPay || paymentSubmitting.current || busy || loading) return;
    if (method === "BANK_TRANSFER" && !canBankPay) return;
    const request = allocations && amount !== undefined ? payRequestFromPreview({ amount, allocations }) : { settlementIds: [...selected.keys()], amount, allocations };
    const { settlementIds } = request;
    if (settlementIds.length === 0) {
      toast.error("Тооцоо сонгоно уу.");
      return;
    }
    if (settlementIds.length > MAX_SETTLEMENT_SELECTION) { toast.error("Нэг удаа ихдээ 50 мөр төлнө."); return; }
    if (ownerRequired && !ownerAdminId) {
      toast.error("Эзэн сонгоно уу. Өөр эзний өрийг нэгтгэхгүй.");
      return;
    }
    paymentSubmitting.current = true;
    setBusy(true);
    if (method === "QPAY") setInvoiceCreating(true);
    try {
      const result = await leasingApi.itgelPay({
        settlementIds,
        method,
        amount: request.amount,
        allocations: request.allocations,
        ownerAdminId: ownerQuery,
        bankRef: method === "BANK_TRANSFER" ? bankRef : undefined,
        bankDate: method === "BANK_TRANSFER" ? bankDate : undefined,
        receiptUrl: method === "BANK_TRANSFER" && receiptUrl ? receiptUrl : undefined,
      });
      if (method === "QPAY") {
        showInvoice(result);
        if (result.invoice?.qrText || result.invoice?.qrImage || result.invoice?.invoiceId) {
          toast.success(result.resumed ? "Хадгалсан нэхэмжлэлийг үргэлжлүүллээ." : "QPay нэхэмжлэл бэлэн.");
        } else if (result.invoicePending) {
          toast.error("QPay нэхэмжлэл тодорхойгүй. Үргэлжлүүлж хайна; шинээр үүсгэхгүй.");
        } else {
          toast.error("QPay хариу ирээгүй. Амжилттай гэж үзэхгүй.");
        }
      } else {
        toast.success("Шилжүүлэг бүртгэгдлээ. Үндсэн админ батална.");
        setBankOpen(false);
      }
      setCustomOpen(false);
      setSelected(new Map());
      setPreview(null);
      setInvoiceCreating(false);
      setBusy(false);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Төлбөр үүсгэж чадсангүй.");
    } finally {
      paymentSubmitting.current = false;
      setBusy(false);
      setInvoiceCreating(false);
    }
  };

  const openCustom = async () => {
    if (busy || loading) return;
    const amount = parseMoneyInput(customAmount);
    if (amount === null) {
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
    if (!canSelectPay || busy) return;
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
    if (!canSelectPay || busy) return;
    setBusy(true);
    try {
      const result = await leasingApi.itgelResume(id);
      showInvoice(result);
      if (result.invoice) {
        toast.success(result.resumed ? "Нэхэмжлэлийг хадгалсан QR-оос сэргээлээ." : "Нэхэмжлэлийг үргэлжлүүллээ.");
      } else {
        toast.error("QPay нэхэмжлэл тодорхойгүй. Жагсаалтаас олдохгүй бол цуцална уу.");
      }
      setBusy(false);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Үргэлжлүүлж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const cancelInvoice = async (id: string) => {
    if (!canSelectPay || busy) return;
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
    if (!canConfirmBank || busy) return;
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
    if (!canConfirmBank || busy || !rejectId || rejectReason.trim().length < 3) return;
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
    <div className={canSelectPay && selectedAmount > 0 ? "pb-64 sm:pb-28" : ""}>
      <PageHead
        title={variant === "leasing" ? "Итгэлд төлөх" : "Лизингийн тооцоо"}
        hint={
          variant === "leasing"
            ? "Төлөх захиалгуудаа сонгоод Итгэлийн QPay-ээр төлнө. Хэрэглэгчийн төлөлтөөс тусдаа Итгэлтэй хийх тооцоо."
            : "Хэнээс, ямар захиалгад, хэд орсон, хэд үлдсэнийг энд батална. Дансны мэдүүлэг өр хаахгүй."
        }
      />

      {canPay && <Card className="mb-5 flex flex-col gap-3 p-4">
        <div className="text-[16px] font-medium">Итгэлд мөнгө төлөх</div>
        <ol className="m-0 list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
          <li>{ownerRequired ? "Хариуцагчаа сонгоод төлөх захиалгын мөрүүдийг чагтална." : "Доорх жагсаалтаас төлөх захиалгын мөрүүдийг чагтална."}</li>
          <li>QPay-ээр QR уншуулах эсвэл банкны апп нээж төлнө. Хэсэгчлэн төлөх бол дүнгээ оруулна.</li>
          {paymentOptions?.manualBankAllowed && <li>Лизингийн админ дансны гүйлгээ бүртгэх эрхтэй. Лавлагаа, огноог үндсэн админ баталсны дараа үлдэгдэл буурна.</li>}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button loading={busy} disabled={!canSelectPay || selectedAmount <= 0 || loading || paymentOptions?.qpayReady === false} onClick={() => void pay("QPAY")}>QPay-ээр төлөх{selectedAmount > 0 ? ` · ${money(selectedAmount)}` : ""}</Button>
          <Button variant="outline" disabled={!canSelectPay || selectedAmount <= 0 || busy || loading} onClick={() => { setCustomOpen(true); setCustomAmount(String(selectedAmount)); setPreview(null); }}>Хэсэгчлэн төлөх</Button>
          {paymentOptions?.manualBankAllowed && <Button variant="outline" disabled={!canBankPay || selectedAmount <= 0 || busy || loading} onClick={() => { setPreview(null); setBankOpen(true); }}>Дансны гүйлгээ бүртгэх</Button>}
        </div>
        <p className="m-0 text-[12px] text-muted">{selected.size ? `${selected.size} мөр · ${selectedOrders} захиалга сонгосон. ` : "Төлбөрийн товч идэвхжүүлэхийн тулд мөрөө сонгоно уу. "}Нэг удаад ихдээ 50 мөр төлнө.</p>
        {paymentOptions?.qpayReady === false && <p className="m-0 text-[13px] text-warn">Итгэлийн QPay одоогоор идэвхгүй. Үндсэн админтай холбогдоно уу.</p>}

      </Card>}

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

      <fieldset disabled={busy} className="m-0 mb-4 grid min-w-0 grid-cols-2 gap-3 border-0 p-0 sm:flex sm:flex-wrap sm:items-end">
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
          <SearchField value={search} onChange={setSearch} placeholder="Захиалга, хэрэглэгч, бараа" />
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
      </fieldset>

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

      {canSelectPay && (invoiceCreating || activeInvoice || activeInvoicePending) && (
        <Card className="mb-4 flex flex-col items-center gap-3 p-4">
          <div className="text-[15px] font-medium">
            {invoiceCreating
              ? "Нэхэмжлэл үүсгэж байна"
              : activeInvoicePending
                ? "QPay нэхэмжлэл тодорхойгүй. Үргэлжлүүлэх нь хайна, шинээр үүсгэхгүй."
                : `Итгэлд төлөх QPay · ${money(activeInvoice?.amount ?? 0)}`}
          </div>
          {invoiceCreating ? (
            <p className="mb-0 mt-0 text-center text-[13px] text-ink-2">
              QPay хариу иртэл хүлээнэ. Хариу ирээгүй байхад амжилттай гэж үзэхгүй.
            </p>
          ) : null}
          {activeInvoice?.urls && activeInvoice.urls.length > 0 && <div className="w-full max-w-lg">
            <p className="mb-2 mt-0 text-center text-[13px] text-ink-2">Утаснаасаа банкны апп сонгож төлөх</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{activeInvoice.urls.filter((bank) => bank.link && !/^(javascript|data|vbscript):/i.test(bank.link.trim())).map((bank) => <a key={bank.link} href={bank.link} className="flex min-h-11 items-center justify-center rounded-lg border border-line px-3 py-2 text-center text-[13px] text-ink no-underline hover:bg-surface">{bank.description || bank.name}</a>)}</div>
          </div>}
          {activeInvoice?.shortUrl && /^https?:\/\//i.test(activeInvoice.shortUrl) && <a href={activeInvoice.shortUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] underline">QPay төлбөрийн холбоос нээх</a>}
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
          {activePaymentId && !invoiceCreating ? (
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
          ) : null}
        </Card>
      )}

      {tab === "unpaid" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {canSelectPay && <Button size="sm" variant="outline" disabled={busy || loading} onClick={() => {
              const available = lines.filter((line) => line.selectable && line.remainingAmount > 0);
              setSelected(addSettlementSelection(new Map(), available));
            }}>Харагдаж буй боломжит мөрүүдийг сонгох</Button>}
            {selected.size > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(new Map())}>Сонголт цэвэрлэх</Button>}
            <Button size="sm" variant="outline" disabled={lines.length === 0} onClick={() => downloadReportCsv("itgel-settlements.csv", ["Захиалга", "Хэрэглэгч", "Бараа", "Ширхэг", "Нийт", "Орсон", "Үлдэгдэл", "Төлөв"], lines.map((line) => [line.orderCode, line.customerName, line.productName, line.qty, line.amount, line.paidAmount, line.remainingAmount, line.statusLabel]))}>Жагсаалт CSV татах</Button>
            <span className="ml-auto text-[12px] text-muted">{lines.length} мөр ачаалагдсан</span>
          </div>
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
                            disabled={busy || loading}
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
                                disabled={busy || loading || (!selected.has(line.id) && selected.size >= MAX_SETTLEMENT_SELECTION)}
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
                                  {line.lockPaymentId && canSelectPay && (!ownerRequired || line.ownerAdminId === ownerQuery) && (
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
                        {PAYMENT_STATUS_LABEL[p.status] ?? p.status}
                        {p.bankRef ? ` · ${p.bankRef}` : ""}
                      </div>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                      {p.method === "QPAY" && canSelectPay && (!ownerRequired || p.ownerAdminId === ownerQuery) && (
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
                  <PaymentEvidence payment={p} />
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
          <div className="mb-4"><Select value={historyStatus} onChange={setHistoryStatus} options={[
            { value: "", label: "Бүх төлөлт" }, { value: "CONFIRMED", label: "Баталгаажсан" },
            { value: "REJECTED", label: "Буцаасан" }, { value: "SUPERSEDED", label: "Цуцалсан" },
          ]} /></div>
          {history.length === 0 ? (
            <Empty>Энэ шүүлтээр төлөлт алга.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {history.map((p) => (
                <Card key={p.id} className="p-4">
                  <div className="font-medium">
                    {p.method === "QPAY" ? "QPay" : "Данс"} · нийт {money(p.amount)} · {PAYMENT_STATUS_LABEL[p.status] ?? p.status}
                  </div>
                  <div className="text-[13px] text-ink-2">
                    {p.status === "CONFIRMED" ? historyDateLabel(p) : p.createdAt.slice(0, 10)}
                    {p.ownerName ? ` · ${p.ownerName}` : ""}
                    {p.bankRef ? ` · ${p.bankRef}` : ""}
                  </div>
                  <PaymentEvidence payment={p} />
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
              <Button loading={busy} disabled={loading || paymentOptions?.qpayReady === false} className="min-h-11 w-full sm:w-auto" onClick={() => void pay("QPAY")}>
                QPay-ээр төлөх
              </Button>
              <Button
                variant="outline"
                disabled={busy || loading}
                className="min-h-11 w-full sm:w-auto"
                onClick={() => {
                  setCustomOpen(true);
                  setCustomAmount(String(selectedAmount));
                  setPreview(null);
                }}
              >
                Дүн оруулж төлөх
              </Button>
              {canBankPay && <Button variant="ghost" disabled={busy || loading} className="min-h-11 w-full sm:w-auto" onClick={() => { setPreview(null); setBankOpen(true); }}>
                Дансны гүйлгээ бүртгэх
              </Button>}
            </div>
          </div>
        </div>
      )}

      {customOpen && (
        <Card className="fixed inset-x-3 bottom-3 z-30 flex max-h-[85dvh] flex-col gap-3 overflow-auto p-4 sm:inset-auto sm:bottom-24 sm:right-6 sm:w-[420px]">
          <div className="text-[15px] font-medium">Дүн оруулж төлөх</div>
          <Field label="Төгрөг (бүхэл)">
            <Input disabled={busy} value={customAmount} onChange={setCustomAmount} inputMode="numeric" />
          </Field>
          <div className="flex gap-2">
            <Button loading={busy} onClick={() => void openCustom()}>
              Хуваарилалт харах
            </Button>
            <Button disabled={busy} variant="ghost" onClick={() => setCustomOpen(false)}>
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
                  disabled={paymentOptions?.qpayReady === false}
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
                  disabled={!canBankPay || busy}
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

      {bankOpen && canBankPay && (
        <Card className="fixed inset-x-3 bottom-3 z-30 flex max-h-[85dvh] max-w-[480px] flex-col gap-3 overflow-auto p-4 sm:left-auto sm:bottom-24 sm:right-6">
          <div className="text-[15px] font-medium">Дансаар шилжүүлсэн</div>
          <p className="m-0 text-[13px] text-ink-2">
            Баримт оруулсан төдийд өр хаагдахгүй. Дүн: {money(preview?.amount ?? selectedAmount)}
          </p>
          <Field label="Гүйлгээний лавлагаа">
            <Input disabled={busy} value={bankRef} onChange={setBankRef} />
          </Field>
          <Field label="Огноо">
            <Input disabled={busy} type="date" value={bankDate} onChange={setBankDate} />
          </Field>
          <Field label="Баримтын холбоос">
            <Input disabled={busy} value={receiptUrl} onChange={setReceiptUrl} placeholder="https://" />
          </Field>
          <div className="flex gap-2">
            <Button
              loading={busy}
              disabled={!bankRef.trim() || !bankDate || loading}
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
            <Button disabled={busy} variant="ghost" onClick={() => setBankOpen(false)}>
              Болих
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
