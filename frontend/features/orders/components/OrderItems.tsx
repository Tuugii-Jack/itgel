"use client";

import { Card } from "@/components/ui";
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
  return (
    <Card className="divide-y divide-line">
      {order.items.map((item) => (
        <div key={item.id} className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <div
              className={`text-[15px] leading-[1.4] ${item.cancelled ? "text-muted line-through" : ""}`}
            >
              {item.name}
            </div>
            <div className="text-[13px] text-muted">
              {formatSelections(item.selections, item.size, item.color)}
              {formatSelections(item.selections, item.size, item.color) ? " · " : ""}
              {item.qty} ш × {money(item.unitPrice)}
            </div>
            {item.cancelled && item.cancelReason && (
              <div className="mt-1 text-[13px] text-danger">
                {item.transferredAt ? "Бэлэн бараанд шилжүүлсэн" : "Цуцлагдсан"}: {item.cancelReason}
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={`tnum text-[15px] ${item.cancelled ? "text-muted line-through" : ""}`}>
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
    </Card>
  );
}
