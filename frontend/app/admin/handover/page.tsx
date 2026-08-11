"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { QrScanner } from "@/components/QrScanner";
import { OrderBadge, PageHead } from "@/components/admin/shared";
import { Badge, Button, Card, Divider, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { money, phoneLabel } from "@/lib/format";
import { printHandoverReceipt } from "@/lib/handoverReceipt";
import { formatSelections } from "@/lib/options";
import { useToast } from "@/lib/toast";
import type {
  AdminOrderDetail,
  AdminOrderRow,
  HandoverCustomer,
  HandoverCustomerItem,
} from "@/lib/types";

type Found = AdminOrderDetail & {
  canHandOver: boolean;
  blockReason: string | null;
  pickableItemIds?: string[];
};

const ITEM_STATUS_LABEL: Record<HandoverCustomerItem["itemStatus"], string> = {
  waiting: "Хүлээж байна",
  arrived: "Ирсэн",
  handed_over: "Авсан",
  cancelled: "Цуцлагдсан",
};

type DueOrderLine = {
  code: string;
  dueAmount: number;
  subtotal: number;
  deliveryFee: number;
  storageFee: number;
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
  primaryDisabled,
  primaryLoading,
  onPrimary,
}: {
  maxWidth: string;
  printDisabled?: boolean;
  onPrint: () => void;
  primaryLabel: string;
  primaryAmount?: number | null;
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
                <span className="text-[12px] font-normal opacity-90">бэлэн авч, хүлээлгэн өгөх</span>
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

/**
 * Төлбөрийн задаргаа: бараа + хүргэлт + агуулах = нийт → төлсөн → үлдэгдэл.
 */
function PaymentDueCard({
  subtotal = 0,
  deliveryFee = 0,
  storageFee = 0,
  paidAmount = 0,
  dueAmount,
  orders,
  cashTaken,
  onCashTaken,
  selectedDue,
}: {
  subtotal?: number;
  deliveryFee?: number;
  storageFee?: number;
  paidAmount?: number;
  dueAmount: number;
  orders?: DueOrderLine[];
  cashTaken?: boolean;
  onCashTaken?: (v: boolean) => void;
  selectedDue?: number;
}) {
  const fromOrders = orders && orders.length > 0;
  const goods = fromOrders ? orders.reduce((s, o) => s + o.subtotal, 0) : subtotal;
  const delivery = fromOrders ? orders.reduce((s, o) => s + o.deliveryFee, 0) : deliveryFee;
  const storage = fromOrders ? orders.reduce((s, o) => s + o.storageFee, 0) : storageFee;
  const paid = fromOrders ? orders.reduce((s, o) => s + o.paidAmount, 0) : paidAmount;
  const total = goods + delivery + storage;
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

      {onCashTaken && collect > 0 && (
        <label className="flex cursor-pointer items-start gap-2.5 border-t border-line bg-warn-bg px-4 py-3 text-[14px] leading-[1.45] text-ink">
          <input
            type="checkbox"
            checked={Boolean(cashTaken)}
            onChange={(e) => onCashTaken(e.target.checked)}
            className="mt-0.5 size-4 shrink-0"
          />
          <span>
            <span className="tnum font-medium">{money(collect)}</span>-ийг бэлнээр авлаа.
          </span>
        </label>
      )}
    </Card>
  );
}

/** Ажилтан нөгөө гартаа хайрцаг барьж байгаа — товч доод талд, том. */
export default function HandoverPage() {
  const toast = useToast();
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
  /** Үлдэгдэлтэй захиалгад бэлэн мөнгө авсныг ажилтан баталгаажуулсан эсэх. */
  const [cashTaken, setCashTaken] = useState(false);

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

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const resetSelection = () => {
    setSelected(new Set());
    setCashTaken(false);
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
        const pickable = list[0]!.items.filter((i) => i.canPick).map((i) => i.id);
        setSelected(new Set(pickable));
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
    setSelected(new Set(c.items.filter((i) => i.canPick).map((i) => i.id)));
    setCashTaken(false);
  };

  const dueForSelected = useMemo(() => {
    if (!activeCustomer) return 0;
    const orderDue = new Map<string, number>();
    for (const item of activeCustomer.items) {
      if (!selected.has(item.id)) continue;
      if (!orderDue.has(item.orderId)) orderDue.set(item.orderId, item.dueAmount);
    }
    return [...orderDue.values()].reduce((a, b) => a + b, 0);
  }, [activeCustomer, selected]);

  const selectedItems = useMemo(() => {
    if (!activeCustomer) return [];
    return activeCustomer.items.filter((i) => selected.has(i.id));
  }, [activeCustomer, selected]);

  const toggleItem = (id: string, canPick: boolean) => {
    if (!canPick) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const printSlip = () => {
    if (!activeCustomer || selectedItems.length === 0) return;
    try {
      printHandoverReceipt({
        customerName: activeCustomer.name,
        customerPhone: activeCustomer.phone,
        customerEmail: activeCustomer.email,
        items: selectedItems.map((item) => ({
          orderCode: item.orderCode,
          name: item.name,
          selections: item.selections,
          size: item.size,
          color: item.color,
          qty: item.qty,
          unitPrice: item.unitPrice,
        })),
        collectedAmount: dueForSelected > 0 ? dueForSelected : 0,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Хэвлэж чадсангүй.");
    }
  };

  const printFoundSlip = () => {
    if (!found) return;
    const items = found.items.filter((i) => !i.cancelled && i.itemStatus !== "handed_over");
    if (items.length === 0) {
      toast.error("Хэвлэх бараа байхгүй.");
      return;
    }
    try {
      printHandoverReceipt({
        customerName: found.customer.name,
        customerPhone: found.customer.phone,
        customerEmail: found.customer.email,
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
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Хэвлэж чадсангүй.");
    }
  };

  const markReceived = async () => {
    if (!activeCustomer || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.handoverPartial({
        itemIds: [...selected],
        collectedAmount: dueForSelected > 0 ? dueForSelected : 0,
        note: dueForSelected > 0 ? "Хүлээлгэн өгөх үед бэлнээр авсан" : undefined,
      });
      setDone(`${result.itemCount} бараа өгсөн`);
      toast.success(`${result.itemCount} бараа хүлээлгэж өглөө.`);
      setActiveCustomer(null);
      setCustomers(null);
      setCustomerQ("");
      resetSelection();
      await loadPending();
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
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.handoverComplete(
        found.id,
        found.dueAmount > 0
          ? { collectedAmount: found.dueAmount, note: "Хүлээлгэн өгөх үед бэлнээр авсан" }
          : { collectedAmount: 0 },
      );
      setDone(result.code);
      toast.success(`${result.code} хүлээлгэж өглөө.`);
      setFound(null);
      setCode("");
      setCashTaken(false);
      await loadPending();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хүлээлгэн өгч чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

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
            paidAmount: o.paidAmount,
          }))}
          selectedDue={dueForSelected}
          cashTaken={cashTaken}
          onCashTaken={setCashTaken}
        />

        <Card className="mb-3 divide-y divide-line">
          {activeCustomer.items.map((item) => {
            const checked = selected.has(item.id);
            const sel = formatSelections(item.selections, item.size, item.color);
            return (
              <label
                key={item.id}
                className={`flex cursor-pointer items-start gap-3 p-4 ${
                  item.canPick ? "" : "opacity-70"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0"
                  disabled={!item.canPick}
                  checked={checked}
                  onChange={() => toggleItem(item.id, item.canPick)}
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
          printDisabled={selected.size === 0}
          onPrint={printSlip}
          primaryLabel={
            dueForSelected > 0
              ? `${money(dueForSelected)} авч өгөх`
              : `Авсан (${selected.size})`
          }
          primaryAmount={dueForSelected > 0 ? dueForSelected : null}
          primaryDisabled={selected.size === 0 || (dueForSelected > 0 && !cashTaken)}
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
              setCashTaken(false);
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
          paidAmount={found.paidAmount}
          cashTaken={cashTaken}
          onCashTaken={setCashTaken}
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
          onPrint={printFoundSlip}
          primaryLabel={
            found.dueAmount > 0 ? `${money(found.dueAmount)} авч өгөх` : "Хүлээлгэн өгөх"
          }
          primaryAmount={found.dueAmount > 0 ? found.dueAmount : null}
          primaryDisabled={!found.canHandOver || (found.dueAmount > 0 && !cashTaken)}
          primaryLoading={busy}
          onPrimary={complete}
        />
      </div>
    );
  }

  // Байдал 1 — хайлт
  return (
    <div className="mx-auto max-w-[480px]">
      <PageHead
        title="Хүлээлгэн өгөх"
        hint={loading ? "Ачаалж байна…" : `Өнөөдөр авах ёстой: ${pending.length}`}
      />

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
    </div>
  );
}
