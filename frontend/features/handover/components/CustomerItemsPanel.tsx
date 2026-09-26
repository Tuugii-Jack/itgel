"use client";

import { useState } from "react";
import { Badge, Button, Card, ErrorNote } from "@/components/ui";
import { money, phoneLabel } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import type { HandoverCustomer, HandoverCustomerItem, HandoverPayMethod } from "@/lib/types";
import { ITEM_STATUS_LABEL } from "../constants";
import { isCheckableItem, isReceiptItem, paySub } from "../utils";
import { HandoverActionBar } from "./HandoverActionBar";
import { PaymentDueCard } from "./PaymentDueCard";

export function CustomerItemsPanel({
  customer,
  selected,
  dueForSelected,
  pickableSelected,
  printItems,
  payMethod,
  error,
  busy,
  onToggleItem,
  onPayMethod,
  onBack,
  onPrint,
  onMarkReceived,
}: {
  customer: HandoverCustomer;
  selected: Set<string>;
  dueForSelected: number;
  pickableSelected: HandoverCustomerItem[];
  printItems: HandoverCustomerItem[];
  payMethod: HandoverPayMethod | null;
  error: string | null;
  busy: boolean;
  onToggleItem: (id: string, checkable: boolean) => void;
  onPayMethod: (v: HandoverPayMethod) => void;
  onBack: () => void;
  onPrint: () => void;
  onMarkReceived: (lines: { itemId: string; qty: number; expectedHandedQty: number }[]) => void;
}) {
  const [qtyById, setQtyById] = useState<Record<string, number>>(() => {
    const next: Record<string, number> = {};
    for (const item of customer.items) {
      const pick = item.pickableQty ?? 0;
      if (pick > 0) next[item.id] = pick;
    }
    return next;
  });
  const giveCount = pickableSelected.reduce(
    (sum, item) => sum + Math.min(qtyById[item.id] ?? item.pickableQty ?? 0, item.pickableQty ?? 0),
    0,
  );
  return (
    <div className="mx-auto max-w-[560px] pb-40">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-[20px] font-medium">{customer.name ?? "Нэргүй"}</div>
          <div className="mt-1 text-[14px] text-ink-2">
            {customer.phone ? (
              <a href={`tel:${customer.phone}`} className="tnum">
                {phoneLabel(customer.phone)}
              </a>
            ) : (
              "Утасгүй"
            )}
            {customer.email ? ` · ${customer.email}` : ""}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
            <Badge tone="neutral">Нийт {customer.totals.items}</Badge>
            <Badge tone="warn">Хүлээж {customer.totals.waiting}</Badge>
            <Badge tone="ok">Ирсэн {customer.totals.arrived}</Badge>
            <Badge tone="neutral">Авсан {customer.totals.handedOver}</Badge>
          </div>
          <p className="mt-2 mb-0 text-[12px] leading-[1.4] text-muted">
            Бараа сонгоод кассын цаасанд хэвлэ → гарын үсэг зуруул → «Авсан» дарна.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          Буцах
        </Button>
      </div>

      <PaymentDueCard
        dueAmount={customer.totals.dueAmount ?? 0}
        shopDueAmount={customer.totals.shopDueAmount ?? customer.totals.dueAmount}
        leasingDueAmount={customer.totals.leasingDueAmount ?? 0}
        orders={(customer.orders ?? []).map((o) => ({
          code: o.code,
          dueAmount: o.dueAmount,
          shopDueAmount: o.shopDueAmount,
          leasingDueAmount: o.leasingDueAmount,
          isLeasing: o.isLeasing,
          subtotal: o.subtotal,
          deliveryFee: o.deliveryFee,
          storageFee: o.storageFee,
          cargoFee: o.cargoFee,
          paidAmount: o.paidAmount,
        }))}
        selectedDue={dueForSelected}
        payMethod={payMethod}
        onPayMethod={onPayMethod}
      />

      <Card className="mb-3 divide-y divide-line">
        {customer.items.map((item) => {
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
                onChange={() => onToggleItem(item.id, checkable)}
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
                  {item.isLeasing ? <Badge tone="neutral">Лизинг</Badge> : null}
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
                <div className="mt-1 tnum text-[12px] text-muted">
                  Захиалсан {item.qty} · ирсэн {item.arrivedQty ?? 0} · олгосон {item.handedOverQty ?? 0} ·
                  одоо олгох {item.pickableQty ?? 0} · ирээгүй {item.waitingQty ?? Math.max(0, item.qty - (item.arrivedQty ?? 0))}
                </div>
                {item.canPick && (item.pickableQty ?? 0) > 0 ? (
                  <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                    Энэ удаа
                    <input
                      type="number"
                      min={1}
                      max={item.pickableQty}
                      value={Math.min(qtyById[item.id] ?? item.pickableQty ?? 1, item.pickableQty ?? 1)}
                      className="tnum h-9 w-16 rounded-[8px] border border-line bg-bg px-2 text-[14px]"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const max = item.pickableQty ?? 1;
                        const next = Math.max(1, Math.min(max, Number(e.target.value) || 1));
                        setQtyById((prev) => ({ ...prev, [item.id]: next }));
                      }}
                    />
                    / {item.pickableQty} ш
                  </label>
                ) : null}
                {item.isLeasing &&
                (item.leasingDueAmount ?? 0) > 0 &&
                item.itemStatus === "arrived" &&
                !item.canPick ? (
                  <div className="mt-1 text-[12px] text-muted">
                    Лизингийн үлдэгдэл — дэлгүүрийн кассанд бүү ав
                  </div>
                ) : null}
              </div>
              <span className="tnum shrink-0 text-[18px] font-medium">{item.qty} ш</span>
            </label>
          );
        })}
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}

      <HandoverActionBar
        maxWidth="560px"
        printDisabled={printItems.length === 0 && !customer.items.some(isReceiptItem)}
        onPrint={onPrint}
        primaryLabel={
          dueForSelected > 0
            ? `${money(dueForSelected)} авч өгөх`
            : `Авсан (${giveCount} ш)`
        }
        primaryAmount={dueForSelected > 0 ? dueForSelected : null}
        primarySub={paySub(payMethod)}
        primaryDisabled={pickableSelected.length === 0 || (dueForSelected > 0 && !payMethod)}
        primaryLoading={busy}
        onPrimary={() =>
          onMarkReceived(
            pickableSelected.map((item) => ({
              itemId: item.id,
              qty: Math.min(qtyById[item.id] ?? item.pickableQty ?? 1, item.pickableQty ?? 1),
              expectedHandedQty: item.handedOverQty ?? 0,
            })),
          )
        }
      />
    </div>
  );
}
