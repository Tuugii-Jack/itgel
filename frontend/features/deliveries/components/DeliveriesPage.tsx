"use client";

import { useEffect, useState } from "react";
import { DELIVERY_STATUS_LABEL, Metric, PageHead, Select } from "@/components/admin/shared";
import { Button, Card, Empty, ErrorNote, Skeleton } from "@/components/ui";
import { isFullAdmin } from "@/lib/admin-role";
import { useAdminSession } from "@/lib/admin-session";
import { MONTH_LABELS } from "@/lib/format";
import { printDeliveries } from "@/lib/printDeliveries";
import type { DeliveryStatus } from "@/lib/types";
import { useDeliveries } from "../hooks/useDeliveries";
import type { DeliveriesTab } from "../hooks/useDeliveries";
import { useDeliveryHistory } from "../hooks/useDeliveryHistory";
import { pad } from "../utils";
import { DeliveryList } from "./DeliveryList";
import { HistoryPanel, WEEKDAYS } from "./HistoryPanel";

const STATUSES: DeliveryStatus[] = ["PENDING", "ASSIGNED", "DELIVERED"];

export function DeliveriesPage() {
  const { user } = useAdminSession();
  const canWrite = isFullAdmin(user?.role);
  const [tab, setTab] = useState<DeliveriesTab>("send");

  const {
    today,
    todayKey,
    years,
    year,
    month,
    setYear,
    setMonth,
    history,
    historyLoading,
    historyError,
    openDate,
    setOpenDate,
    dayRows,
    dayLoading,
    loadHistory,
    openHistoryDay,
    cells,
    byDate,
    selectableDates,
  } = useDeliveryHistory();

  const {
    selectedDays,
    setSelectedDays,
    selectedDistricts,
    setSelectedDistricts,
    status,
    setStatus,
    zoneFilter,
    setZoneFilter,
    rows,
    couriers,
    loading,
    refreshing,
    busy,
    error,
    visibleRows,
    zones,
    allGroups,
    allZones,
    pending,
    cityCount,
    aimagCount,
    toggleDay,
    toggleDistrict,
    save,
    onCourier,
    printOpts,
    printSelection,
  } = useDeliveries(tab);

  useEffect(() => {
    if (tab !== "history" || !openDate) return;
    void openHistoryDay(openDate);
  }, [tab, openDate, openHistoryDay]);

  return (
    <div>
      <PageHead
        title="Хүргэлт"
        hint={
          tab === "history"
            ? "Хүргэсэн түүх — он сар, өдрөөр"
            : "Олон өдөр, олон дүүрэг сонгоод хэвлэж өгнө"
        }
        actions={
          tab === "send" ? (
            <Button variant="outline" disabled={visibleRows.length === 0} onClick={printSelection}>
              Хэвлэж өгөх
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={!dayRows || dayRows.length === 0}
              onClick={() => dayRows && printDeliveries(dayRows, { day: openDate ?? undefined })}
            >
              Өдрийг хэвлэх
            </Button>
          )
        }
      />

      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto">
        {(
          [
            { key: "send" as const, label: "Явуулах" },
            { key: "history" as const, label: "Түүх" },
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

      {tab === "history" ? (
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
          dayRows={dayRows}
          dayLoading={dayLoading}
          canWrite={canWrite}
          busy={busy}
          couriers={couriers}
          onCourier={onCourier}
          onSave={async (id, patch) => {
            await save(id, patch);
            if (openDate) void openHistoryDay(openDate);
            void loadHistory(year, month);
          }}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select
              value={String(year)}
              onChange={(v) => setYear(Number(v))}
              options={years.map((y) => ({ value: String(y), label: `${y} он` }))}
            />
            <Select
              value={String(month)}
              onChange={(v) => setMonth(Number(v))}
              options={MONTH_LABELS.map((m, i) => ({ value: String(i + 1), label: m }))}
            />
            <Select
              value={status}
              onChange={setStatus}
              placeholder="Хүргээгүй"
              options={STATUSES.map((s) => ({ value: s, label: DELIVERY_STATUS_LABEL[s] }))}
            />
            <Select
              value={zoneFilter}
              onChange={(v) => setZoneFilter((v as "" | "city" | "aimag") || "")}
              placeholder="Хот / аймаг"
              options={[
                { value: "city", label: "Хот" },
                { value: "aimag", label: "Аймаг" },
              ]}
            />
            <Button
              variant="outline"
              onClick={() => {
                setYear(today.getFullYear());
                setMonth(today.getMonth() + 1);
                setSelectedDays([todayKey]);
                setSelectedDistricts(new Set());
              }}
            >
              Өнөөдөр
            </Button>
            {refreshing && <span className="text-[13px] text-muted">Шинэчилж байна…</span>}
          </div>

          {error && (
            <div className="mb-4">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}

          <Card className="mb-5 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-[15px] font-medium">Өдөр сонгох</div>
                <div className="mt-0.5 text-[13px] text-muted">
                  {selectedDays.length > 0
                    ? `${selectedDays.length} өдөр сонгосон`
                    : "Олон өдөр дарж сонгоно."}
                </div>
              </div>
              {selectableDates.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const allOn = selectableDates.every((d) => selectedDays.includes(d));
                    setSelectedDays(allOn ? [] : [...selectableDates]);
                    setSelectedDistricts(new Set());
                  }}
                  className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-ink-2 underline"
                >
                  {selectableDates.every((d) => selectedDays.includes(d))
                    ? "Арилгах"
                    : "Хүргэлттэй өдрүүдийг сонгох"}
                </button>
              )}
            </div>

            {historyLoading && !history ? (
              <Skeleton className="h-56 w-full rounded-[12px]" />
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((d) => (
                  <div key={d} className="py-1 text-center text-[12px] text-muted">
                    {d}
                  </div>
                ))}
                {cells.map((day, i) => {
                  if (day == null) return <div key={`e-${i}`} />;
                  const date = `${year}-${pad(month)}-${pad(day)}`;
                  const stats = byDate.get(date);
                  const active = selectedDays.includes(date);
                  const isToday = date === todayKey;
                  const has = Boolean(stats);
                  return (
                    <button
                      key={date}
                      type="button"
                      disabled={!has && !active}
                      onClick={() => toggleDay(date, byDate)}
                      className={`min-h-[56px] rounded-[8px] border p-1.5 text-left ${
                        active
                          ? "border-ink bg-ink text-white"
                          : has
                            ? "cursor-pointer border-line bg-bg hover:border-primary-muted"
                            : "cursor-default border-transparent bg-transparent text-muted"
                      } ${isToday && !active ? "ring-1 ring-ink/30" : ""}`}
                    >
                      <div className="text-[13px] font-medium">{day}</div>
                      {has && (
                        <div className={`mt-0.5 text-[11px] ${active ? "opacity-80" : "text-muted"}`}>
                          {stats!.total} хүргэлт
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {allZones.length > 0 && (
            <Card className="mb-5 p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="text-[15px] font-medium">Дүүрэг сонгох</div>
                  <div className="mt-0.5 text-[13px] text-muted">
                    Баянзүрх, Сүхбаатар гэх мэт хэдэн ч дүүрэг сонгоод хэвлэж өгнө.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedDistricts(
                      selectedDistricts.size === allGroups.length
                        ? new Set()
                        : new Set(allGroups.map((g) => g.district)),
                    )
                  }
                  className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-ink-2 underline"
                >
                  {selectedDistricts.size === allGroups.length ? "Арилгах" : "Бүгдийг сонгох"}
                </button>
              </div>

              {allZones.map((zone) => (
                <div key={zone.zone} className="mb-3 last:mb-0">
                  <div className="mb-1.5 text-[13px] font-medium text-ink-2">{zone.label}</div>
                  <div className="flex flex-wrap gap-2">
                    {zone.groups.map((g) => {
                      const on = selectedDistricts.has(g.district);
                      return (
                        <button
                          key={g.district}
                          type="button"
                          onClick={() => toggleDistrict(g.district)}
                          className={`cursor-pointer rounded-[8px] border px-3 py-2 text-left ${
                            on
                              ? "border-ink bg-ink text-white"
                              : "border-line bg-bg text-ink hover:border-primary-muted"
                          }`}
                        >
                          <div className="text-[13px] font-medium">{g.title}</div>
                          <div className={`tnum text-[12px] ${on ? "opacity-80" : "text-muted"}`}>
                            {g.rows.length} хүргэлт
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="mt-4 border-t border-line pt-4">
                <div className="mb-3 text-[13px] text-ink-2">
                  {selectedDays.length} өдөр
                  {selectedDistricts.size > 0 ? ` · ${selectedDistricts.size} дүүрэг` : " · бүх дүүрэг"}
                  {` · ${visibleRows.length} хүргэлт`}
                </div>
                <Button full disabled={visibleRows.length === 0} onClick={printSelection}>
                  Хэвлэж өгөх
                </Button>
              </div>
            </Card>
          )}

          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Хэвлэх" value={visibleRows.length} />
            <Metric label="Явуулаагүй" value={pending} tone="warn" />
            <Metric label="Хот" value={cityCount} />
            <Metric label="Аймаг" value={aimagCount} />
          </div>

          {loading && rows.length === 0 && selectedDays.length > 0 ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-[12px]" />
              ))}
            </div>
          ) : selectedDays.length === 0 ? (
            <Empty>Өдөр сонгоно уу.</Empty>
          ) : visibleRows.length === 0 ? (
            <Empty>Сонгосон өдөр, дүүрэгт хүргэлт алга.</Empty>
          ) : (
            <DeliveryList
              zones={zones}
              printOpts={printOpts}
              couriers={couriers}
              onCourier={onCourier}
              busy={busy}
              onSave={save}
              readOnly={!canWrite}
            />
          )}

          {canWrite && (
            <p className="mt-4 mb-0 text-[13px] text-muted">
              Сонгосон жагсаалтыг хэвлээд хүргэлтийн хүнд өгнө. «Хүргэсэн» гэж тэмдэглэхэд захиалга
              «Хүлээлгэн өгсөн» болно.
            </p>
          )}
        </>
      )}
    </div>
  );
}
