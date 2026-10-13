"use client";

import { useState } from "react";
import { Package } from 'lucide-react';
import { Badge, Card } from "@/components/ui";
import { money } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import type { AdminOrderDetail } from "@/lib/types";
import { CancelItem } from "./CancelItem";

export function OrderItems({
  order,
  canCancelItems,
  busy,
  busyKey,
  onCancel,
}: {
  order: AdminOrderDetail;
  canCancelItems: boolean;
  busy: boolean;
  busyKey: string | null;
  onCancel: (itemId: string, reason: string | undefined, refund: boolean) => Promise<void>;
}) {
  const [openItgel, setOpenItgel] = useState<string | null>(null);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-4"><div className="text-[15px] font-medium">Захиалсан бараа</div><div className="text-[12px] text-muted">{order.items.filter((item) => !item.cancelled).length} идэвхтэй мөр</div></div>
      <div className="divide-y divide-line">
      {order.items.map((item) => (
        <div key={item.id} className={`flex flex-wrap items-start justify-between gap-4 p-5 ${item.cancelled ? 'bg-surface/60' : ''}`}>
          <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary-soft text-secondary sm:flex"><Package className="h-5 w-5" aria-hidden="true" /></div>
          <div className="min-w-0 flex-1">
            <div
              className={`text-[15px] leading-[1.4] ${item.cancelled ? "text-muted line-through" : ""}`}
            >
              {item.name}
            </div>
            <div className="mt-1 text-[13px] text-muted">
              {formatSelections(item.selections, item.size, item.color)}
              {formatSelections(item.selections, item.size, item.color) ? " · " : ""}
              {item.qty} ш × {money(item.unitPrice)}
            </div>
            {!item.cancelled && <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={(item.arrivedQty ?? (item.arrivedAt ? item.qty : 0)) > 0 ? 'info' : 'neutral'}>Ирсэн {item.arrivedQty ?? (item.arrivedAt ? item.qty : 0)} / {item.qty}</Badge>
              <Badge tone={(item.handedOverQty ?? (item.handedOverAt ? item.qty : 0)) > 0 ? 'ok' : 'neutral'}>Олгосон {item.handedOverQty ?? (item.handedOverAt ? item.qty : 0)} / {item.qty}</Badge>
            </div>}
            {item.itgel && (
              <div className="mt-1">
                <div className="text-[13px] text-ink-2">
                  Хэрэглэгч: {order.paymentStateLabel}
                  {" · "}
                  <button
                    type="button"
                    className="cursor-pointer border-0 bg-transparent p-0 underline"
                    onClick={() => setOpenItgel((id) => (id === item.id ? null : item.id))}
                  >
                    Итгэлд: {item.itgel.statusLabel}
                  </button>
                </div>
                {openItgel === item.id && (
                  <div className="mt-1 text-[12px] text-ink-2">
                    {money(item.itgel.amount)} · төлсөн {money(item.itgel.paidAmount)} · үлдэгдэл{" "}
                    {money(item.itgel.remainingAmount)} · {item.itgel.confirmedAt.slice(0, 10)}
                  </div>
                )}
              </div>
            )}
            {item.cancelled && item.cancelReason && (
              <div className="mt-1 text-[13px] text-danger">
                {item.transferredAt ? "Бэлэн бараанд шилжүүлсэн" : "Цуцлагдсан"}: {item.cancelReason}
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={`tnum text-[16px] font-medium ${item.cancelled ? "text-muted line-through" : ""}`}>
              {money(item.total)}
            </span>
            {!item.cancelled && !item.handedOverAt && canCancelItems && order.status !== "HANDED_OVER" && (
              <CancelItem
                disabled={busy}
                loading={busyKey === `item:${item.id}`}
                onCancel={(reason, refund) => onCancel(item.id, reason, refund)}
              />
            )}
          </div>
        </div>
      ))}
      </div>
    </Card>
  );
}
