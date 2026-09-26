"use client";

import { useMemo, useState } from "react";
import { OrderBadge } from "@/components/admin/shared";
import { Badge, Button, Card, ErrorNote } from "@/components/ui";
import { money, phoneLabel } from "@/lib/format";
import { leasingAccountDue, shopDueOf } from "@/lib/leasing";
import { formatSelections } from "@/lib/options";
import type { HandoverPayMethod } from "@/lib/types";
import { ITEM_STATUS_LABEL } from "../constants";
import { isReceiptItem, paySub, type Found } from "../utils";
import { HandoverActionBar } from "./HandoverActionBar";
import { PaymentDueCard } from "./PaymentDueCard";

export function FoundOrderPanel({
  found,
  payMethod,
  error,
  busy,
  onPayMethod,
  onCancel,
  onPrint,
  onComplete,
}: {
  found: Found;
  payMethod: HandoverPayMethod | null;
  error: string | null;
  busy: boolean;
  onPayMethod: (v: HandoverPayMethod) => void;
  onCancel: () => void;
  onPrint: () => void;
  onComplete: (lines: { itemId: string; qty: number; expectedHandedQty: number }[]) => void;
}) {
  const pickable = useMemo(
    () => new Set(found.pickableItemIds ?? found.items.filter((i) => (i.pickableQty ?? 0) > 0).map((i) => i.id)),
    [found],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(pickable));
  const [qtyById, setQtyById] = useState<Record<string, number>>(() => {
    const next: Record<string, number> = {};
    for (const item of found.items) {
      const pick = item.pickableQty ?? 0;
      if (pick > 0) next[item.id] = pick;
    }
    return next;
  });
  const selectedIds = [...selected].filter((id) => pickable.has(id));
  const arrivedCount = found.items.reduce((sum, i) => sum + (i.arrivedQty ?? 0), 0);
  const handedCount = found.items.reduce((sum, i) => sum + (i.handedOverQty ?? 0), 0);
  const pickableCount = found.items.reduce((sum, i) => sum + (i.pickableQty ?? 0), 0);
  const waitingCount = found.items.reduce((sum, i) => sum + (i.waitingQty ?? 0), 0);

  const toggle = (id: string) => {
    if (!pickable.has(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-[480px] pb-40">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="tnum text-[24px] font-medium">{found.code}</div>
          <div className="mt-1">
            <OrderBadge status={found.status} />
          </div>
          <p className="mt-2 mb-0 text-[12px] leading-[1.4] text-muted">
            QR бол хайлт. Хүлээн авагчийг QR эсвэл нэвтрэлтээр батлахгүй. Цаасан баримтад гарын үсэг зуруулна.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
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
        <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
          <Badge tone="ok">Ирсэн {arrivedCount} ш</Badge>
          <Badge tone="neutral">Өмнө олгосон {handedCount} ш</Badge>
          <Badge tone="warn">Олгох {pickableCount} ш</Badge>
          {waitingCount > 0 ? <Badge tone="warn">Ирээгүй {waitingCount} ш</Badge> : null}
        </div>
      </Card>

      <PaymentDueCard
        dueAmount={found.dueAmount}
        shopDueAmount={shopDueOf(found)}
        leasingDueAmount={leasingAccountDue(found)}
        isLeasing={found.isLeasing}
        subtotal={found.subtotal}
        deliveryFee={found.deliveryFee}
        storageFee={found.storageFee}
        cargoFee={found.cargoFee}
        paidAmount={found.paidAmount}
        payMethod={payMethod}
        onPayMethod={onPayMethod}
      />

      <Card className="mb-3 divide-y divide-line">
        {found.items.map((item) => {
          const sel = formatSelections(item.selections, item.size, item.color);
          const checkable = pickable.has(item.id);
          const arrivedQty = item.arrivedQty ?? 0;
          const handedQty = item.handedOverQty ?? 0;
          const pickableQty = item.pickableQty ?? 0;
          const waitingQty = item.waitingQty ?? Math.max(0, item.qty - arrivedQty);
          const giveQty = Math.min(qtyById[item.id] ?? pickableQty, pickableQty);
          return (
            <label
              key={item.id}
              className={`flex items-start gap-3 p-4 ${checkable ? "cursor-pointer" : "opacity-70"}`}
            >
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0"
                disabled={!checkable}
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
              />
              <div className="min-w-0 flex-1">
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
                  {found.isLeasing ? <Badge tone="neutral">Лизинг</Badge> : null}
                </div>
                {sel ? <div className="text-[14px] text-muted">{sel}</div> : null}
                <div className="mt-1 tnum text-[12px] text-muted">
                  Захиалсан {item.qty} · ирсэн {arrivedQty} · олгосон {handedQty} ·
                  одоо олгох {pickableQty} · ирээгүй {waitingQty}
                </div>
                {checkable && pickableQty > 0 ? (
                  <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                    Энэ удаа
                    <input
                      type="number"
                      min={1}
                      max={pickableQty}
                      value={giveQty}
                      className="tnum h-9 w-16 rounded-[8px] border border-line bg-bg px-2 text-[14px]"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const next = Math.max(1, Math.min(pickableQty, Number(e.target.value) || 1));
                        setQtyById((prev) => ({ ...prev, [item.id]: next }));
                      }}
                    />
                    / {pickableQty} ш
                  </label>
                ) : null}
              </div>
              <span className="tnum shrink-0 text-[20px] font-medium">{item.qty} ш</span>
            </label>
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
        onPrint={onPrint}
        primaryLabel={
          shopDueOf(found) > 0 ? `${money(shopDueOf(found))} авч өгөх` : `Олгох (${selectedIds.reduce((sum, id) => sum + (qtyById[id] ?? 0), 0)} ш)`
        }
        primaryAmount={shopDueOf(found) > 0 ? shopDueOf(found) : null}
        primarySub={paySub(payMethod)}
        primaryDisabled={
          !found.canHandOver ||
          selectedIds.length === 0 ||
          (shopDueOf(found) > 0 && !payMethod)
        }
        primaryLoading={busy}
        onPrimary={() =>
          onComplete(
            selectedIds.map((itemId) => {
              const item = found.items.find((row) => row.id === itemId);
              const pickableQty = item?.pickableQty ?? 1;
              return {
                itemId,
                qty: Math.min(qtyById[itemId] ?? pickableQty, pickableQty),
                expectedHandedQty: item?.handedOverQty ?? 0,
              };
            }),
          )
        }
      />
    </div>
  );
}
