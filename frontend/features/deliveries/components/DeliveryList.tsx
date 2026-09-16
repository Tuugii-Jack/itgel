"use client";

import { Button } from "@/components/ui";
import { printDeliveries, splitDeliveryZones } from "@/lib/printDeliveries";
import { districtCourierLabel } from "../utils";
import { DeliveryCard } from "./DeliveryCard";

export function DeliveryList({
  zones,
  printOpts,
  couriers,
  onCourier,
  busy,
  onSave,
  readOnly,
}: {
  zones: ReturnType<typeof splitDeliveryZones>;
  printOpts: { day?: string; days?: string[]; district?: string };
  couriers: Record<string, string>;
  onCourier: (id: string, v: string) => void;
  busy: string | null;
  onSave: (id: string, patch: { courierName?: string | null; status?: string }) => void;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-col gap-10">
      {zones.map((zone) => (
        <div key={zone.zone}>
          <h2 className="mb-4 text-[18px] font-medium">{zone.label}</h2>
          <div className="flex flex-col gap-8">
            {zone.groups.map(({ district, title, rows: list }) => (
              <section key={district} id={`place-${encodeURIComponent(district)}`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="m-0 text-[17px] font-medium">{title}</h3>
                    <div className="tnum mt-0.5 text-[13px] text-muted">
                      {list.length} хүргэлт
                      {districtCourierLabel(list) ? ` · ${districtCourierLabel(list)}` : ""}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => printDeliveries(list, { ...printOpts, district })}
                  >
                    Хэвлэх
                  </Button>
                </div>
                <div className="flex flex-col gap-3">
                  {list.map((row) => (
                    <DeliveryCard
                      key={row.id}
                      row={row}
                      courier={couriers[row.id] ?? row.courierName ?? ""}
                      onCourier={(v) => onCourier(row.id, v)}
                      busy={busy === row.id}
                      onSave={onSave}
                      readOnly={readOnly}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
