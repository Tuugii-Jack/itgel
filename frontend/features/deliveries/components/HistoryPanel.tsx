"use client";

import { useMemo } from "react";
import { Metric, Select } from "@/components/admin/shared";
import { Badge, Button, Empty, ErrorNote, Spinner } from "@/components/ui";
import { dayLabel, MONTH_LABELS } from "@/lib/format";
import { placeTitle } from "@/lib/locations";
import { groupDeliveriesByDistrict, printDeliveries, splitDeliveryZones } from "@/lib/printDeliveries";
import type { AdminDelivery, DeliveryHistory } from "@/lib/types";
import { DeliveryList } from "./DeliveryList";

export const WEEKDAYS = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];

export function HistoryPanel({
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
  dayRows,
  dayLoading,
  canWrite,
  busy,
  couriers,
  onCourier,
  onSave,
}: {
  year: number;
  month: number;
  years: number[];
  onYear: (v: number) => void;
  onMonth: (v: number) => void;
  history: DeliveryHistory | null;
  loading: boolean;
  error: string | null;
  openDate: string | null;
  onOpenDate: (date: string) => void;
  dayRows: AdminDelivery[] | null;
  dayLoading: boolean;
  canWrite: boolean;
  busy: string | null;
  couriers: Record<string, string>;
  onCourier: (id: string, v: string) => void;
  onSave: (id: string, patch: { courierName?: string | null; status?: string }) => void;
}) {
  const open = history?.days.find((d) => d.date === openDate) ?? null;
  const dayGroups = useMemo(
    () => groupDeliveriesByDistrict(dayRows ?? []),
    [dayRows],
  );
  const dayZones = useMemo(() => splitDeliveryZones(dayGroups), [dayGroups]);
  const byCourier = useMemo(() => {
    const map = new Map<string, AdminDelivery[]>();
    for (const row of dayRows ?? []) {
      const key = row.courierName?.trim() || "Хуваарилаагүй";
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "mn"));
  }, [dayRows]);

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
          options={MONTH_LABELS.map((m, i) => ({ value: String(i + 1), label: m }))}
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
        <Empty>Энэ сард хүргэлт байхгүй.</Empty>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Нийт" value={history.summary.total} />
            <Metric label="Хүргэсэн" value={history.summary.delivered} tone="ok" />
            <Metric label="Явуулсан" value={history.summary.assigned} tone="info" />
            <Metric label="Хүлээгдэж" value={history.summary.pending} tone="warn" />
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
                <div className="tnum mt-1 text-[16px] font-medium">
                  {d.delivered}/{d.total} хүргэсэн
                </div>
                <div className="mt-1 text-[12px] text-muted">
                  {d.districts.map((x) => placeTitle(x.name)).join(" · ") || "—"}
                </div>
              </button>
            ))}
          </div>

          {open && (
            <div>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <Metric label="Энэ өдөр хүргэсэн" value={open.delivered} tone="ok" />
                <Metric label="Нийт" value={open.total} />
              </div>
              {open.couriers.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {open.couriers.map((c) => (
                    <Badge key={c.name} tone="info">
                      {c.name} · {c.delivered}/{c.count}
                    </Badge>
                  ))}
                </div>
              )}
              {dayLoading || !dayRows ? (
                <div className="flex justify-center py-10">
                  <Spinner className="text-muted" />
                </div>
              ) : dayRows.length === 0 ? (
                <Empty>Энэ өдөр хүргэлт алга.</Empty>
              ) : (
                <>
                  {byCourier.map(([name, list]) => (
                    <div key={name} className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[15px] font-medium">{name}</div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          printDeliveries(list, {
                            day: open.date,
                            courier: name === "Хуваарилаагүй" ? undefined : name,
                          })
                        }
                      >
                        {name} — хэвлэх
                      </Button>
                    </div>
                  ))}
                  <DeliveryList
                    zones={dayZones}
                    printOpts={{ day: open.date }}
                    couriers={couriers}
                    onCourier={onCourier}
                    busy={busy}
                    onSave={onSave}
                    readOnly={!canWrite}
                  />
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
