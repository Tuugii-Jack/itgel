"use client";

import { OrderBadge } from "@/components/admin/shared";
import { Badge, Card, Empty } from "@/components/ui";
import { dayTimeLabel, money, phoneLabel } from "@/lib/format";
import { PAYMENT_LABEL_SHORT, PAYMENT_TONE } from "@/lib/payment";
import type { ArchiveOrder } from "@/lib/types";

/**
 * Архивын захиалгын жагсаалт — захиалга бүр мөрүүдээ дэлгэсэн байдлаар.
 *
 * Устгасан болон цуцлагдсаныг НУУХГҮЙ, зөвхөн бүдгэрүүлж тэмдэглэнэ:
 * архивын зорилго нь тэр үед юу болсныг хэвээр хадгалах.
 */
export function ArchiveOrderList({
  orders,
  hideCustomer = false,
}: {
  orders: ArchiveOrder[];
  /** Хэрэглэгчийн түүхэн дотор нэрийг давтах шаардлагагүй. */
  hideCustomer?: boolean;
}) {
  if (orders.length === 0) return <Empty>Захиалга байхгүй.</Empty>;

  return (
    <div className="flex flex-col gap-3">
      {orders.map((order) => {
        const dimmed = order.deleted || order.status === "CANCELLED";
        return (
          <Card key={order.id} className={`p-4 ${dimmed ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tnum text-[15px] font-medium">{order.code}</span>
                  <OrderBadge status={order.status} />
                  <Badge tone={PAYMENT_TONE[order.paymentState]}>
                    {PAYMENT_LABEL_SHORT[order.paymentState]}
                  </Badge>
                  {order.deleted && <Badge tone="danger">Устгасан</Badge>}
                  {order.batch && <Badge tone="info">{order.batch.name}</Badge>}
                </div>
                {!hideCustomer && (
                  <div className="mt-1 text-[14px]">
                    {order.customer.name ?? "Нэргүй"}
                    <span className="tnum ml-2 text-[13px] text-muted">
                      {phoneLabel(order.customer.phone)}
                    </span>
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="tnum text-[15px]">{money(order.subtotal)}</div>
                <div className="tnum text-[13px] text-muted">
                  {dayTimeLabel(order.createdAt)}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
              {order.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-baseline justify-between gap-3 text-[13px]"
                >
                  <span className={`min-w-0 ${item.cancelled ? "text-muted line-through" : ""}`}>
                    {item.name}
                    {[item.size, item.color].filter(Boolean).length > 0 && (
                      <span className="text-muted">
                        {" "}
                        · {[item.size, item.color].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  <span
                    className={`tnum shrink-0 ${item.cancelled ? "text-muted line-through" : ""}`}
                  >
                    {item.qty} ш · {money(item.total)}
                  </span>
                </div>
              ))}
            </div>

            {order.dueAmount > 0 && !dimmed && (
              <div className="mt-2 text-[13px] text-warn">
                Үлдэгдэл <span className="tnum">{money(order.dueAmount)}</span>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
