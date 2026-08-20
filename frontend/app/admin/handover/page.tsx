"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Metric, OrderBadge, PageHead, Select } from "@/components/admin/shared";
import { QrScanner } from "@/components/QrScanner";
import { Badge, Button, Card, Divider, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { adminApi, api, ApiError } from "@/lib/api";
import { dayKey, dayLabel, dayTimeLabel, money, phoneLabel } from "@/lib/format";
import { printHandoverReceipt, type HandoverReceiptStore } from "@/lib/handoverReceipt";
import { formatSelections } from "@/lib/options";
import { useToast } from "@/lib/toast";
import type {
  AdminOrderDetail,
  AdminOrderRow,
  HandoverCustomer,
  HandoverCustomerItem,
  HandoverHistory,
  HandoverHistoryDay,
  HandoverPayMethod,
} from "@/lib/types";

type Found = AdminOrderDetail & {
  canHandOver: boolean;
  blockReason: string | null;
  pickableItemIds?: string[];
};

type Tab = "give" | "done";

const PAY_METHOD_KEY = "itgel.handover.payMethod";

function readPayMethod(): HandoverPayMethod | null {
  if (typeof window === "undefined") return null;
  const v = window.sessionStorage.getItem(PAY_METHOD_KEY);
  if (v === "CASH" || v === "CARD" || v === "BANK_TRANSFER") return v;
  return null;
}

function writePayMethod(value: HandoverPayMethod) {
  window.sessionStorage.setItem(PAY_METHOD_KEY, value);
}

const MONTHS = [
  "1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар",
  "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар",
];

const ITEM_STATUS_LABEL: Record<HandoverCustomerItem["itemStatus"], string> = {
  waiting: "Хүлээж байна",
  arrived: "Ирсэн",
  handed_over: "Авсан",
  cancelled: "Цуцлагдсан",
};

function isReceiptItem(item: {
  cancelled?: boolean;
  canPick?: boolean;
  fulfilment?: "PICKUP" | "DELIVERY" | null;
  itemStatus: HandoverCustomerItem["itemStatus"] | AdminOrderDetail["items"][number]["itemStatus"];
}): boolean {
  if (item.cancelled) return false;
  if (item.fulfilment === "DELIVERY" && item.itemStatus !== "handed_over") return false;
  return item.canPick === true || item.itemStatus === "arrived" || item.itemStatus === "handed_over";
}

function isCheckableItem(item: HandoverCustomerItem): boolean {
  return item.canPick || item.itemStatus === "handed_over";
}

function selectableItemIds(items: HandoverCustomerItem[]): string[] {
  const pickable = items.filter((i) => i.canPick).map((i) => i.id);
  if (pickable.length > 0) return pickable;
  return items.filter((i) => i.itemStatus === "handed_over").map((i) => i.id);
}

type DueOrderLine = {
  code: string;
  dueAmount: number;
  subtotal: number;
  deliveryFee: number;
  storageFee: number;
  cargoFee?: number;
  paidAmount: number;
};

function SumLine({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 ${
        strong ? "text-[15px] font-medium text-ink" : muted ? "text-[13px] text-muted" : "text-[13px] text-ink-2"
      }`}
    >
      <span>{label}</span>
      <span className="tnum">{value}</span>
    </div>
  );
}

function paySub(method: HandoverPayMethod | null): string {
  if (method === "CARD") return "картаар авч, хүлээлгэн өгөх";
  if (method === "BANK_TRANSFER") return "дансаар авч, хүлээлгэн өгөх";
  if (method === "CASH") return "бэлэн авч, хүлээлгэн өгөх";
  return "авч, хүлээлгэн өгөх";
}

/**
 * Доод үйлдлийн мөр — sidebar-ийн баруун талд, дүн урт байсан ч эвдрэхгүй.
 * Үндсэн CTA дээр, хэвлэх доор (бүтэн өргөн).
 */
function HandoverActionBar({
  maxWidth,
  printDisabled,
  onPrint,
  primaryLabel,
  primaryAmount,
  primarySub,
  primaryDisabled,
  primaryLoading,
  onPrimary,
}: {
  maxWidth: string;
  printDisabled?: boolean;
  onPrint: () => void;
  primaryLabel: string;
  primaryAmount?: number | null;
  primarySub?: string;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  onPrimary: () => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 lg:left-[220px]">
      <div
        className="pointer-events-auto mx-auto border-t border-line bg-bg px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        style={{ maxWidth }}
      >
        <div className="flex flex-col gap-2">
          <Button
            full
            size="lg"
            loading={primaryLoading}
            disabled={primaryDisabled}
            onClick={onPrimary}
            className="h-14"
          >
            {primaryAmount != null && primaryAmount > 0 ? (
              <span className="flex flex-col items-center leading-tight">
                <span className="tnum text-[17px] font-medium">{money(primaryAmount)}</span>
                <span className="text-[12px] font-normal opacity-90">
                  {primarySub ?? "авч, хүлээлгэн өгөх"}
                </span>
              </span>
            ) : (
              primaryLabel
            )}
          </Button>
          <Button
            full
            variant="outline"
            size="bar"
            disabled={printDisabled}
            onClick={onPrint}
          >
            Баримт хэвлэх
          </Button>
        </div>
      </div>
    </div>
  );
}

function PayMethodPicker({
  amount,
  value,
  onChange,
}: {
  amount: number;
  value: HandoverPayMethod | null;
  onChange: (v: HandoverPayMethod) => void;
}) {
  return (
    <div className="border-t border-line bg-warn-bg px-4 py-3">
      <div className="mb-2 text-[13px] text-ink-2">
        <span className="tnum font-medium text-ink">{money(amount)}</span>-ийг яаж авсан бэ
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { id: "CASH", label: "Бэлэн" },
            { id: "CARD", label: "Карт" },
            { id: "BANK_TRANSFER", label: "Данс" },
          ] as const
        ).map((opt) => {
          const on = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={`h-11 cursor-pointer rounded-[8px] border text-[14px] font-medium ${
                on ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Төлбөрийн задаргаа: бараа + хүргэлт + агуулах = нийт → төлсөн → үлдэгдэл.
 */
function PaymentDueCard({
  subtotal = 0,
  deliveryFee = 0,
  storageFee = 0,
  cargoFee = 0,
  paidAmount = 0,
  dueAmount,
  orders,
  payMethod,
  onPayMethod,
  selectedDue,
}: {
  subtotal?: number;
  deliveryFee?: number;
  storageFee?: number;
  cargoFee?: number;
  paidAmount?: number;
  dueAmount: number;
  orders?: DueOrderLine[];
  payMethod?: HandoverPayMethod | null;
  onPayMethod?: (v: HandoverPayMethod) => void;
  selectedDue?: number;
}) {
  const fromOrders = orders && orders.length > 0;
  const goods = fromOrders ? orders.reduce((s, o) => s + o.subtotal, 0) : subtotal;
  const delivery = fromOrders ? orders.reduce((s, o) => s + o.deliveryFee, 0) : deliveryFee;
  const storage = fromOrders ? orders.reduce((s, o) => s + o.storageFee, 0) : storageFee;
  const cargo = fromOrders ? orders.reduce((s, o) => s + (o.cargoFee ?? 0), 0) : cargoFee;
  const paid = fromOrders ? orders.reduce((s, o) => s + o.paidAmount, 0) : paidAmount;
  const total = goods + delivery + storage + cargo;
  const due = dueAmount;
  const collect = selectedDue ?? due;
  const unpaidOrders = (orders ?? []).filter((o) => o.dueAmount > 0);

  if (due <= 0 && (selectedDue == null || selectedDue <= 0)) {
    return (
      <Card surface className="mb-3 p-4">
        <div className="text-[14px] text-ok">Төлбөр бүрэн төлөгдсөн — авах дүн байхгүй.</div>
      </Card>
    );
  }

  return (
    <Card className="mb-3 overflow-hidden border-line p-0">
      <div className="border-b border-line bg-surface px-4 py-3">
        <div className="text-[13px] text-ink-2">Авах дүн</div>
        <div className="tnum mt-0.5 text-[26px] font-medium leading-tight text-warn">
          {money(collect > 0 ? collect : due)}
        </div>
        {selectedDue != null && selectedDue > 0 && selectedDue !== due && (
          <div className="mt-1 text-[12px] text-muted">
            Нийт үлдэгдэл <span className="tnum">{money(due)}</span> · сонгосон захиалга
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 px-4 py-3">
        <SumLine label="Бараа" value={money(goods)} />
        {delivery > 0 && <SumLine label="Хүргэлт" value={money(delivery)} />}
        {cargo > 0 && <SumLine label="Карго" value={money(cargo)} />}
        {storage > 0 && <SumLine label="Агуулахын хураамж" value={money(storage)} />}
        <div className="my-1 h-px bg-line" />
        <SumLine label="Нийт" value={money(total)} strong />
        {paid > 0 && <SumLine label="Төлсөн" value={`−${money(paid)}`} muted />}
        <SumLine label="Үлдэгдэл" value={money(due)} strong />
      </div>

      {unpaidOrders.length > 1 && (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-2 text-[12px] text-muted">Захиалга бүрээр</div>
          <div className="flex flex-col gap-2">
            {unpaidOrders.map((o) => (
              <div key={o.code} className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="tnum text-ink-2">{o.code}</span>
                <span className="tnum font-medium text-warn">{money(o.dueAmount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {onPayMethod && collect > 0 && (
        <PayMethodPicker amount={collect} value={payMethod ?? null} onChange={onPayMethod} />
      )}
    </Card>
  );
}

function HistoryPanel({
  year,
  month,
  years,
  onYear,
  onMonth,
  history,
  loading,
  error,
  openDate,
  onOpenDate,
  store,
}: {
  year: number;
  month: number;
  years: number[];
  onYear: (v: number) => void;
  onMonth: (v: number) => void;
  history: HandoverHistory | null;
  loading: boolean;
  error: string | null;
  openDate: string | null;
  onOpenDate: (date: string) => void;
  store?: HandoverReceiptStore;
}) {
  const open = history?.days.find((d) => d.date === openDate) ?? null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select
          value={String(year)}
          onChange={(v) => onYear(Number(v))}
          options={years.map((y) => ({ value: String(y), label: `${y} он` }))}
        />
        <Select
          value={String(month)}
          onChange={(v) => onMonth(Number(v))}
          options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
        />
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-muted" />
        </div>
      ) : !history || history.days.length === 0 ? (
        <Empty>Энэ сард хүлээлгэн өгсөн бараа алга.</Empty>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Metric label="Бэлэн" value={money(history.summary.cash)} tone="ok" />
            <Metric label="Карт" value={money(history.summary.card)} />
            <Metric label="Данс" value={money(history.summary.bank)} />
            <Metric label="Хүн" value={history.summary.customerCount} tone="info" />
            <Metric label="Бараа" value={history.summary.itemCount} />
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {history.days.map((d) => (
              <button
                key={d.date}
                type="button"
                onClick={() => onOpenDate(d.date)}
                className={`cursor-pointer rounded-[12px] border p-3 text-left ${
                  openDate === d.date ? "border-ink bg-surface" : "border-line bg-bg hover:bg-surface"
                }`}
              >
                <div className="text-[14px]">{dayLabel(`${d.date}T12:00:00+08:00`)}</div>
                <div className="tnum mt-1 text-[16px] font-medium text-ok">{money(d.cash)}</div>
                <div className="tnum text-[12px] text-muted">
                  бэлэн · карт {money(d.card)}
                </div>
                <div className="mt-1 text-[12px] text-muted">
                  {d.customerCount} хүн · {d.itemCount} бараа
                </div>
              </button>
            ))}
          </div>

          {open && <HistoryDayDetail day={open} store={store} />}
        </>
      )}
    </div>
  );
}

function printHistoryRow(
  row: HandoverHistoryDay["rows"][number],
  store?: HandoverReceiptStore,
) {
  if (row.items.length === 0) {
    throw new Error("Хэвлэх бараа байхгүй.");
  }
  printHandoverReceipt({
    customerName: row.name,
    customerPhone: row.phone,
    orderCodes: row.orderCodes,
    items: row.items.map((item) => ({
      orderCode: row.orderCodes[0] ?? "",
      name: item.name,
      selections: item.selections,
      size: item.size,
      color: item.color,
      qty: item.qty,
    })),
    cashTaken: row.cash,
    cardTaken: row.card,
    bankTaken: row.bank,
    store,
    issuedAt: row.at,
  });
}

function HistoryDayDetail({
  day,
  store,
}: {
  day: HandoverHistoryDay;
  store?: HandoverReceiptStore;
}) {
  const toast = useToast();
  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-3">
        <Metric label="Энэ өдрийн бэлэн" value={money(day.cash)} tone="ok" />
        <Metric label="Карт" value={money(day.card)} />
        <Metric label="Данс" value={money(day.bank)} />
      </div>
      <div className="flex flex-col gap-3">
        {day.rows.map((row) => (
          <Card key={`${row.customerId}-${row.at}`} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[16px] font-medium">{row.name ?? "Нэргүй"}</div>
                <div className="mt-0.5 text-[13px] text-ink-2">
                  {row.phone ? (
                    <a href={`tel:${row.phone}`} className="tnum">
                      {phoneLabel(row.phone)}
                    </a>
                  ) : (
                    "Утасгүй"
                  )}
                  {" · "}
                  <span className="tnum">{dayTimeLabel(row.at)}</span>
                </div>
              </div>
              {(row.cash > 0 || row.card > 0 || row.bank > 0) && (
                <div className="shrink-0 text-right text-[13px]">
                  {row.cash > 0 && (
                    <div className="tnum font-medium text-ok">{money(row.cash)} бэлэн</div>
                  )}
                  {row.card > 0 && (
                    <div className="tnum text-ink-2">{money(row.card)} карт</div>
                  )}
                  {row.bank > 0 && (
                    <div className="tnum text-ink-2">{money(row.bank)} данс</div>
                  )}
                </div>
              )}
            </div>
            {row.orderCodes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {row.orderCodes.map((code) => (
                  <Badge key={code} tone="neutral">
                    {code}
                  </Badge>
                ))}
              </div>
            )}
            {row.items.length > 0 && (
              <div className="mt-3 divide-y divide-line border-t border-line">
                {row.items.map((item, i) => {
                  const sel = formatSelections(item.selections, item.size, item.color);
                  return (
                    <div key={`${item.name}-${i}`} className="flex items-start justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <div className="text-[14px]">{item.name}</div>
                        {sel ? <div className="text-[12px] text-muted">{sel}</div> : null}
                      </div>
                      <span className="tnum shrink-0 text-[14px] font-medium">{item.qty} ш</span>
                    </div>
                  );
                })}
              </div>
            )}
            <Button
              full
              variant="outline"
              className="mt-3"
              disabled={row.items.length === 0}
              onClick={() => {
                try {
                  printHistoryRow(row, store);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Хэвлэж чадсангүй.");
                }
              }}
            >
              Баримт хэвлэх
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Ажилтан нөгөө гартаа хайрцаг барьж байгаа — товч доод талд, том. */
export default function HandoverPage() {
  const toast = useToast();
  const today = useMemo(() => new Date(), []);
  const todayKey = dayKey(today);
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = today.getFullYear() + 1; y >= today.getFullYear() - 4; y--) list.push(y);
    return list;
  }, [today]);

  const [tab, setTab] = useState<Tab>("give");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [history, setHistory] = useState<HandoverHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(todayKey);
  const [todayTake, setTodayTake] = useState<{
    cash: number;
    card: number;
    bank: number;
  } | null>(null);

  const [pending, setPending] = useState<AdminOrderRow[]>([]);
  const [found, setFound] = useState<Found | null>(null);
  const [customers, setCustomers] = useState<HandoverCustomer[] | null>(null);
  const [activeCustomer, setActiveCustomer] = useState<HandoverCustomer | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [code, setCode] = useState("");
  const [customerQ, setCustomerQ] = useState("");
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState<HandoverPayMethod | null>(null);

  useEffect(() => {
    setPayMethod(readPayMethod());
  }, []);

  const choosePayMethod = (value: HandoverPayMethod) => {
    setPayMethod(value);
    writePayMethod(value);
  };
  const [store, setStore] = useState<HandoverReceiptStore | undefined>();

  useEffect(() => {
    void api
      .store()
      .then((s) =>
        setStore({
          name: s.storeName,
          phone: s.phone,
          address: s.address,
        }),
      )
      .catch(() => undefined);
  }, []);

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminApi.orders({ status: "ARRIVED", pageSize: 100 });
      setPending(list.data);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Ачаалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadHistory = useCallback(async (y: number, m: number) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await adminApi.handoverHistory(y, m);
      setHistory(data);
      const now = new Date();
      if (y === now.getFullYear() && m === now.getMonth() + 1) {
        const day = data.days.find((d) => d.date === dayKey(now));
        setTodayTake({ cash: day?.cash ?? 0, card: day?.card ?? 0, bank: day?.bank ?? 0 });
      }
    } catch (e) {
      setHistory(null);
      setHistoryError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  useEffect(() => {
    void loadHistory(year, month);
  }, [year, month, loadHistory]);

  useEffect(() => {
    if (!history) return;
    if (openDate && history.days.some((d) => d.date === openDate)) return;
    setOpenDate(history.days[0]?.date ?? null);
  }, [history, openDate]);

  const resetSelection = () => {
    setSelected(new Set());
  };

  const goToDone = () => {
    const now = new Date();
    setTab("done");
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
    setOpenDate(dayKey(now));
    void loadHistory(now.getFullYear(), now.getMonth() + 1);
  };

  const lookup = useCallback(
    async (raw: string) => {
      setError(null);
      setDone(null);
      setCustomers(null);
      setActiveCustomer(null);
      resetSelection();
      const match = raw.trim().toUpperCase().match(/PH-[A-Z0-9]{6}/);
      const value = match ? match[0] : raw.trim();
      if (!value) return;

      setBusy(true);
      setScanning(false);
      try {
        setFound(await adminApi.handoverLookup(value));
      } catch (e) {
        setFound(null);
        const message = e instanceof ApiError ? e.message : "Хайж чадсангүй.";
        setError(message);
        toast.error(message);
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const searchCustomer = async () => {
    const q = customerQ.trim();
    if (q.length < 2) return;
    setError(null);
    setDone(null);
    setFound(null);
    resetSelection();
    setBusy(true);
    try {
      const list = await adminApi.handoverCustomer(q);
      setCustomers(list);
      setActiveCustomer(list.length === 1 ? list[0]! : null);
      if (list.length === 1) {
        setSelected(new Set(selectableItemIds(list[0]!.items)));
      }
    } catch (e) {
      setCustomers(null);
      setActiveCustomer(null);
      const message = e instanceof ApiError ? e.message : "Хайж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const openCustomer = (c: HandoverCustomer) => {
    setActiveCustomer(c);
    setSelected(new Set(selectableItemIds(c.items)));
  };

  const dueForSelected = useMemo(() => {
    if (!activeCustomer) return 0;
    const orderDue = new Map<string, number>();
    for (const item of activeCustomer.items) {
      if (!selected.has(item.id) || !item.canPick) continue;
      if (!orderDue.has(item.orderId)) orderDue.set(item.orderId, item.dueAmount);
    }
    return [...orderDue.values()].reduce((a, b) => a + b, 0);
  }, [activeCustomer, selected]);

  const selectedItems = useMemo(() => {
    if (!activeCustomer) return [];
    return activeCustomer.items.filter((i) => selected.has(i.id));
  }, [activeCustomer, selected]);

  const pickableSelected = useMemo(
    () => selectedItems.filter((i) => i.canPick),
    [selectedItems],
  );

  const printItems = useMemo(
    () => selectedItems.filter((i) => isReceiptItem(i)),
    [selectedItems],
  );

  const toggleItem = (id: string, checkable: boolean) => {
    if (!checkable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const printSlip = () => {
    if (!activeCustomer) return;
    const items = printItems.length > 0 ? printItems : activeCustomer.items.filter(isReceiptItem);
    if (items.length === 0) {
      toast.error("Хэвлэх бараа байхгүй.");
      return;
    }
    try {
      printHandoverReceipt({
        customerName: activeCustomer.name,
        customerPhone: activeCustomer.phone,
        items: items.map((item) => ({
          orderCode: item.orderCode,
          name: item.name,
          selections: item.selections,
          size: item.size,
          color: item.color,
          qty: item.qty,
          unitPrice: item.unitPrice,
        })),
        collectedAmount: dueForSelected > 0 ? dueForSelected : 0,
        collectedMethod: payMethod ?? undefined,
        store,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Хэвлэж чадсангүй.");
    }
  };

  const printFoundSlip = () => {
    if (!found) return;
    const items = found.items.filter(isReceiptItem);
    if (items.length === 0) {
      toast.error("Хэвлэх бараа байхгүй.");
      return;
    }
    try {
      printHandoverReceipt({
        customerName: found.customer.name,
        customerPhone: found.customer.phone,
        items: items.map((item) => ({
          orderCode: found.code,
          name: item.name,
          selections: item.selections,
          size: item.size,
          color: item.color,
          qty: item.qty,
          unitPrice: item.unitPrice,
        })),
        collectedAmount: found.dueAmount > 0 ? found.dueAmount : 0,
        collectedMethod: payMethod ?? undefined,
        store,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Хэвлэж чадсангүй.");
    }
  };

  const markReceived = async () => {
    if (!activeCustomer || pickableSelected.length === 0) return;
    if (dueForSelected > 0 && !payMethod) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.handoverPartial({
        itemIds: pickableSelected.map((i) => i.id),
        collectedAmount: dueForSelected > 0 ? dueForSelected : 0,
        method: dueForSelected > 0 ? (payMethod ?? undefined) : undefined,
      });
      setDone(`${result.itemCount} бараа өгсөн`);
      toast.success(`${result.itemCount} бараа хүлээлгэж өглөө.`);
      setActiveCustomer(null);
      setCustomers(null);
      setCustomerQ("");
      resetSelection();
      await loadPending();
      goToDone();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хүлээлгэн өгч чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (!found) return;
    if (found.dueAmount > 0 && !payMethod) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.handoverComplete(
        found.id,
        found.dueAmount > 0
          ? { collectedAmount: found.dueAmount, method: payMethod ?? "CASH" }
          : { collectedAmount: 0 },
      );
      setDone(result.code);
      toast.success(`${result.code} хүлээлгэж өглөө.`);
      setFound(null);
      setCode("");
      await loadPending();
      goToDone();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хүлээлгэн өгч чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const tabBar = (
    <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto">
      {(
        [
          { key: "give" as const, label: "Өгөх" },
          { key: "done" as const, label: "Өгсөн" },
        ] as const
      ).map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => setTab(t.key)}
          className={`h-10 shrink-0 cursor-pointer whitespace-nowrap rounded-[8px] border px-4 text-[14px] ${
            tab === t.key ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  // Байдал: хэрэглэгчийн мөрүүд
  if (activeCustomer) {
    return (
      <div className="mx-auto max-w-[560px] pb-40">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[20px] font-medium">{activeCustomer.name ?? "Нэргүй"}</div>
            <div className="mt-1 text-[14px] text-ink-2">
              {activeCustomer.phone ? (
                <a href={`tel:${activeCustomer.phone}`} className="tnum">
                  {phoneLabel(activeCustomer.phone)}
                </a>
              ) : (
                "Утасгүй"
              )}
              {activeCustomer.email ? ` · ${activeCustomer.email}` : ""}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
              <Badge tone="neutral">Нийт {activeCustomer.totals.items}</Badge>
              <Badge tone="warn">Хүлээж {activeCustomer.totals.waiting}</Badge>
              <Badge tone="ok">Ирсэн {activeCustomer.totals.arrived}</Badge>
              <Badge tone="neutral">Авсан {activeCustomer.totals.handedOver}</Badge>
            </div>
            <p className="mt-2 mb-0 text-[12px] leading-[1.4] text-muted">
              Бараа сонгоод кассын цаасанд хэвлэ → гарын үсэг зуруул → «Авсан» дарна.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActiveCustomer(null);
              resetSelection();
              if (customers && customers.length <= 1) setCustomers(null);
            }}
          >
            Буцах
          </Button>
        </div>

        <PaymentDueCard
          dueAmount={activeCustomer.totals.dueAmount ?? 0}
          orders={(activeCustomer.orders ?? []).map((o) => ({
            code: o.code,
            dueAmount: o.dueAmount,
            subtotal: o.subtotal,
            deliveryFee: o.deliveryFee,
            storageFee: o.storageFee,
            cargoFee: o.cargoFee,
            paidAmount: o.paidAmount,
          }))}
          selectedDue={dueForSelected}
          payMethod={payMethod}
          onPayMethod={choosePayMethod}
        />

        <Card className="mb-3 divide-y divide-line">
          {activeCustomer.items.map((item) => {
            const checked = selected.has(item.id);
            const sel = formatSelections(item.selections, item.size, item.color);
            const checkable = isCheckableItem(item);
            return (
              <label
                key={item.id}
                className={`flex cursor-pointer items-start gap-3 p-4 ${
                  checkable ? "" : "opacity-70"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0"
                  disabled={!checkable}
                  checked={checked}
                  onChange={() => toggleItem(item.id, checkable)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tnum text-[13px] text-muted">{item.orderCode}</span>
                    <Badge
                      tone={
                        item.itemStatus === "arrived"
                          ? "ok"
                          : item.itemStatus === "handed_over"
                            ? "neutral"
                            : item.itemStatus === "cancelled"
                              ? "danger"
                              : "warn"
                      }
                    >
                      {ITEM_STATUS_LABEL[item.itemStatus]}
                    </Badge>
                    {item.fulfilment === "DELIVERY" && item.itemStatus === "arrived" ? (
                      <Badge tone="info">Хүргэлт</Badge>
                    ) : null}
                  </div>
                  <div
                    className={`mt-0.5 text-[16px] leading-[1.4] ${
                      item.itemStatus === "handed_over" || item.cancelled
                        ? "text-muted line-through"
                        : ""
                    }`}
                  >
                    {item.name}
                  </div>
                  {sel ? <div className="text-[13px] text-muted">{sel}</div> : null}
                </div>
                <span className="tnum shrink-0 text-[18px] font-medium">{item.qty} ш</span>
              </label>
            );
          })}
        </Card>

        {error && <ErrorNote>{error}</ErrorNote>}

        <HandoverActionBar
          maxWidth="560px"
          printDisabled={printItems.length === 0 && !activeCustomer.items.some(isReceiptItem)}
          onPrint={printSlip}
          primaryLabel={
            dueForSelected > 0
              ? `${money(dueForSelected)} авч өгөх`
              : `Авсан (${pickableSelected.length})`
          }
          primaryAmount={dueForSelected > 0 ? dueForSelected : null}
          primarySub={paySub(payMethod)}
          primaryDisabled={pickableSelected.length === 0 || (dueForSelected > 0 && !payMethod)}
          primaryLoading={busy}
          onPrimary={() => void markReceived()}
        />
      </div>
    );
  }

  // Олон хэрэглэгч олдсон
  if (customers && customers.length > 1) {
    return (
      <div className="mx-auto max-w-[560px]">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[17px] font-medium">{customers.length} хэрэглэгч олдлоо</div>
          <Button variant="ghost" size="sm" onClick={() => setCustomers(null)}>
            Буцах
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          {customers.map((c) => {
            const due = c.totals.dueAmount ?? 0;
            return (
              <Card key={c.id} className="p-4">
                <div className="text-[16px] font-medium">{c.name ?? "Нэргүй"}</div>
                <div className="mt-1 text-[13px] text-ink-2">
                  {c.phone ? phoneLabel(c.phone) : "—"} · {c.email}
                </div>
                <div className="mt-2 text-[13px] text-muted">
                  Нийт {c.totals.items} · Ирсэн {c.totals.arrived} · Авсан {c.totals.handedOver}
                </div>
                {due > 0 && (
                  <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-line pt-3">
                    <span className="text-[13px] text-ink-2">Үлдэгдэл</span>
                    <span className="tnum text-[17px] font-medium text-warn">{money(due)}</span>
                  </div>
                )}
                <Button full variant="outline" className="mt-3" onClick={() => openCustomer(c)}>
                  Нээх
                </Button>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // Байдал 2 — захиалга олдсон (код/QR)
  if (found) {
    return (
      <div className="mx-auto max-w-[480px] pb-40">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="tnum text-[24px] font-medium">{found.code}</div>
            <div className="mt-1">
              <OrderBadge status={found.status} />
            </div>
            <p className="mt-2 mb-0 text-[12px] leading-[1.4] text-muted">
              Баримт хэвлэ → гарын үсэг зуруул → хүлээлгэн өгөх.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFound(null);
            }}
          >
            Цуцлах
          </Button>
        </div>

        <Card className="mb-3 p-4">
          <div className="text-[17px]">{found.customer.name ?? "Нэргүй"}</div>
          <div className="text-[14px] text-ink-2">
            {found.customer.phone ? (
              <a href={`tel:${found.customer.phone}`} className="tnum">
                {phoneLabel(found.customer.phone)}
              </a>
            ) : (
              "Утасгүй"
            )}
            {found.customer.email ? ` · ${found.customer.email}` : ""}
          </div>
        </Card>

        <PaymentDueCard
          dueAmount={found.dueAmount}
          subtotal={found.subtotal}
          deliveryFee={found.deliveryFee}
          storageFee={found.storageFee}
          cargoFee={found.cargoFee}
          paidAmount={found.paidAmount}
          payMethod={payMethod}
          onPayMethod={choosePayMethod}
        />

        <Card className="mb-3 divide-y divide-line">
          {found.items.map((item) => {
            const sel = formatSelections(item.selections, item.size, item.color);
            return (
              <div key={item.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div
                      className={`text-[17px] leading-[1.4] ${
                        item.itemStatus === "handed_over" || item.cancelled
                          ? "text-muted line-through"
                          : ""
                      }`}
                    >
                      {item.name}
                    </div>
                    <Badge
                      tone={
                        item.itemStatus === "arrived"
                          ? "ok"
                          : item.itemStatus === "handed_over"
                            ? "neutral"
                            : item.itemStatus === "cancelled"
                              ? "danger"
                              : "warn"
                      }
                    >
                      {ITEM_STATUS_LABEL[item.itemStatus]}
                    </Badge>
                    {item.fulfilment === "DELIVERY" && item.itemStatus === "arrived" ? (
                      <Badge tone="info">Хүргэлт</Badge>
                    ) : null}
                  </div>
                  {sel ? <div className="text-[14px] text-muted">{sel}</div> : null}
                </div>
                <span className="tnum shrink-0 text-[20px] font-medium">{item.qty} ш</span>
              </div>
            );
          })}
        </Card>

        {error && <ErrorNote>{error}</ErrorNote>}
        {!found.canHandOver && found.blockReason && (
          <div className="mt-3">
            <ErrorNote>{found.blockReason}</ErrorNote>
          </div>
        )}

        <HandoverActionBar
          maxWidth="480px"
          printDisabled={!found.items.some(isReceiptItem)}
          onPrint={printFoundSlip}
          primaryLabel={
            found.dueAmount > 0 ? `${money(found.dueAmount)} авч өгөх` : "Хүлээлгэн өгөх"
          }
          primaryAmount={found.dueAmount > 0 ? found.dueAmount : null}
          primarySub={paySub(payMethod)}
          primaryDisabled={!found.canHandOver || (found.dueAmount > 0 && !payMethod)}
          primaryLoading={busy}
          onPrimary={complete}
        />
      </div>
    );
  }

  // Байдал 1 — хайлт / өгсөн түүх
  return (
    <div className="mx-auto max-w-[560px]">
      <PageHead
        title="Хүлээлгэн өгөх"
        hint={
          tab === "done"
            ? "Өмнө өгсөн хүмүүс, тухайн өдрийн бэлэн орлого"
            : loading
              ? "Ачаалж байна…"
              : `Өнөөдөр авах ёстой: ${pending.length}`
        }
      />

      {tabBar}

      {tab === "done" ? (
        <HistoryPanel
          year={year}
          month={month}
          years={years}
          onYear={setYear}
          onMonth={setMonth}
          history={history}
          loading={historyLoading}
          error={historyError}
          openDate={openDate}
          onOpenDate={setOpenDate}
          store={store}
        />
      ) : (
        <>
          {todayTake && (
            <div className="mb-4 grid grid-cols-3 gap-3">
              <Metric
                label="Өнөөдөр бэлэн"
                value={money(todayTake.cash)}
                tone="ok"
                sub="дэлгүүрт орсон"
              />
              <Metric label="Карт" value={money(todayTake.card)} sub="өнөөдөр" />
              <Metric label="Данс" value={money(todayTake.bank)} sub="өнөөдөр" />
            </div>
          )}

          {done && (
            <Card className="mb-4 border-ok bg-ok-bg p-4">
              <span className="tnum text-[14px] text-ok">{done} — хүлээлгэн өгсөн.</span>
            </Card>
          )}

          {scanning ? (
            <div className="mb-4">
              <QrScanner onResult={lookup} />
              <Button full variant="outline" className="mt-3" onClick={() => setScanning(false)}>
                Скан хаах
              </Button>
            </div>
          ) : (
            <Button full variant="outline" className="mb-4 h-14" onClick={() => setScanning(true)}>
              QR уншуулах
            </Button>
          )}

          <Card className="mb-4 flex flex-col gap-3 p-4">
            <div className="text-[14px] font-medium">Утас, нэр эсвэл и-мэйл</div>
            <p className="m-0 text-[13px] leading-[1.4] text-muted">
              Утсаар захиалсан / сайт дээр «өөрөө авна» дараагүй байсан ч утасны дугаараар олж өгнө.
            </p>
            <Input
              value={customerQ}
              onChange={setCustomerQ}
              placeholder="99112233 / Бат / you@gmail.com"
            />
            <Button full onClick={() => void searchCustomer()} loading={busy} disabled={customerQ.trim().length < 2}>
              Хэрэглэгч хайх
            </Button>
          </Card>

          <Card className="mb-6 flex flex-col gap-3 p-4">
            <div className="text-[14px] text-ink-2">Эсвэл захиалгын код</div>
            <Input
              value={code}
              onChange={(v) => setCode(v.toUpperCase())}
              placeholder="PH-XXXXXX"
              maxLength={9}
            />
            <Button full onClick={() => lookup(code)} loading={busy} disabled={code.length < 3}>
              Кодоор хайх
            </Button>
            {error && <ErrorNote>{error}</ErrorNote>}
          </Card>

          <Divider className="mb-4" />

          <div className="mb-2 text-[15px] font-medium">Хүлээгдэж буй</div>
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner className="text-muted" />
            </div>
          ) : pending.length === 0 ? (
            <Empty>Хүлээгдэж буй захиалга алга.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {pending.map((order) => (
                <Card key={order.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="tnum text-[15px] font-medium">{order.code}</div>
                      <div className="text-[13px] text-muted">
                        {order.customer.name ?? "Нэргүй"} ·{" "}
                        <span className="tnum">{phoneLabel(order.customer.phone)}</span>
                      </div>
                    </div>
                    <OrderBadge status={order.status} />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="text-muted">
                      {order.itemCount} бараа ·{" "}
                      {order.fulfilment === "DELIVERY"
                        ? "Хүргэлт"
                        : order.fulfilment === "PICKUP"
                          ? "Өөрөө авна"
                          : "Сонгоогүй"}
                      {(order.storageFee ?? 0) > 0 ? ` · Агуулах ${money(order.storageFee)}` : ""}
                      {(order.cargoFee ?? 0) > 0 ? ` · Карго ${money(order.cargoFee)}` : ""}
                    </span>
                    <span
                      className={`tnum font-medium ${order.dueAmount > 0 ? "text-warn" : "text-ok"}`}
                    >
                      {order.dueAmount > 0 ? `Үлдэгдэл ${money(order.dueAmount)}` : "Төлөгдсөн"}
                    </span>
                  </div>
                  <Button full variant="outline" className="mt-3" onClick={() => lookup(order.code)}>
                    Нээх
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
