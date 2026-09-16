"use client";

import { DELIVERY_STATUS_LABEL } from "@/components/admin/shared";
import { Badge, Button, Card, Input } from "@/components/ui";
import { dayLabel, money, phoneLabel, relativeDay, weekdayShort } from "@/lib/format";
import { formatPlaceLine, placeZone, zoneLabel } from "@/lib/locations";
import { formatSelections } from "@/lib/options";
import type { AdminDelivery } from "@/lib/types";

export function DeliveryCard({
  row,
  courier,
  onCourier,
  busy,
  onSave,
  readOnly,
}: {
  row: AdminDelivery;
  courier: string;
  onCourier: (v: string) => void;
  busy: boolean;
  onSave: (id: string, patch: { courierName?: string | null; status?: string }) => void;
  readOnly?: boolean;
}) {
  const items = row.order.items ?? [];

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tnum text-[15px] font-medium">{row.order.code}</span>
            <Badge
              tone={
                row.status === "DELIVERED" ? "ok" : row.status === "ASSIGNED" ? "info" : "neutral"
              }
            >
              {DELIVERY_STATUS_LABEL[row.status]}
            </Badge>
          </div>
          <div className="mt-2 text-[16px] font-medium">
            {row.order.customer.name ?? "Нэргүй"}
          </div>
          <a href={`tel:${row.order.customer.phone ?? ""}`} className="tnum mt-0.5 block text-[15px]">
            {phoneLabel(row.order.customer.phone)}
          </a>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[14px]">
            <Badge tone={placeZone(row.district) === "aimag" ? "info" : "neutral"}>
              {zoneLabel(placeZone(row.district))}
            </Badge>
            <span>{formatPlaceLine(row.district, row.khoroo)}</span>
          </div>
          {row.addressText && (
            <div className="mt-0.5 text-[14px] leading-[1.45] text-ink">{row.addressText}</div>
          )}
          {items.length > 0 && (
            <ul className="mt-3 mb-0 flex list-none flex-col gap-1 p-0">
              {items.map((item, i) => {
                const sel = formatSelections(item.selections, item.size, item.color);
                return (
                  <li key={`${item.name}-${i}`} className="text-[13px] leading-[1.4] text-ink-2">
                    {item.name}
                    {sel ? ` · ${sel}` : ""}
                    <span className="tnum"> × {item.qty}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {row.order.note && (
            <div className="mt-2 text-[13px] text-ink-2">Тэмдэглэл: {row.order.note}</div>
          )}
        </div>

        <div className="text-right">
          <div className="tnum text-[13px] text-ink-2">
            {weekdayShort(row.scheduledDay)} · {dayLabel(row.scheduledDay)}
          </div>
          <div className="text-[12px] text-muted">{relativeDay(row.scheduledDay)}</div>
          {row.order.dueAmount > 0 && (
            <div className="tnum mt-2 text-[13px] text-warn">
              Үлдэгдэл {money(row.order.dueAmount)}
            </div>
          )}
        </div>
      </div>

      {!readOnly && row.status !== "DELIVERED" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <div className="min-w-[180px] flex-1">
            <Input value={courier} onChange={onCourier} placeholder="Жолоочийн нэр" />
          </div>
          <Button
            variant="outline"
            onClick={() =>
              onSave(row.id, {
                courierName: courier.trim() || null,
                status: courier.trim() ? "ASSIGNED" : "PENDING",
              })
            }
            loading={busy}
          >
            Хадгалах
          </Button>
          <Button onClick={() => onSave(row.id, { status: "DELIVERED" })} loading={busy}>
            Хүргэсэн
          </Button>
        </div>
      )}
    </Card>
  );
}
