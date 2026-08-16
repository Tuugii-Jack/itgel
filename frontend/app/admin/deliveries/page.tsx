"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DELIVERY_STATUS_LABEL, Metric, PageHead, Select } from "@/components/admin/shared";
import { Badge, Button, Card, Empty, ErrorNote, Input, Skeleton, Spinner } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { isFullAdmin } from "@/lib/admin-role";
import { useAdminSession } from "@/lib/admin-session";
import { dayKey, dayLabel, money, phoneLabel, relativeDay, weekdayShort } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import { groupDeliveriesByDistrict, printDeliveries, splitDeliveryZones } from "@/lib/printDeliveries";
import { formatPlaceLine, placeTitle, placeZone, zoneLabel } from "@/lib/locations";
import { useToast } from "@/lib/toast";
import type { AdminDelivery, DeliveryHistory, DeliveryStatus } from "@/lib/types";

const STATUSES: DeliveryStatus[] = ["PENDING", "ASSIGNED", "DELIVERED"];
const MONTHS = [
  "1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар",
  "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар",
];
const WEEKDAYS = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];

type Tab = "send" | "history";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function monthCells(year: number, month: number): (number | null)[] {
  const last = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();
  const lead = firstDow === 0 ? 6 : firstDow - 1;
  const cells: (number | null)[] = [
    ...Array<number | null>(lead).fill(null),
    ...Array.from({ length: last }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function districtCourierLabel(list: AdminDelivery[]): string | null {
  const open = list.filter((r) => r.status !== "DELIVERED");
  const names = [...new Set(open.map((r) => r.courierName?.trim()).filter(Boolean))] as string[];
  if (names.length === 1) return names[0]!;
  if (names.length > 1) return `${names.length} хүн`;
  return null;
}

export default function DeliveriesPage() {
  const toast = useToast();
  const { user } = useAdminSession();
  const canWrite = isFullAdmin(user?.role);
  const today = useMemo(() => new Date(), []);
  const todayKey = dayKey(today);
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = today.getFullYear() + 1; y >= today.getFullYear() - 4; y--) list.push(y);
    return list;
  }, [today]);

  const [tab, setTab] = useState<Tab>("send");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDays, setSelectedDays] = useState<string[]>(() => [dayKey(new Date())]);
  const [selectedDistricts, setSelectedDistricts] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [zoneFilter, setZoneFilter] = useState<"" | "city" | "aimag">("");
  const [rows, setRows] = useState<AdminDelivery[]>([]);
  const [couriers, setCouriers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<DeliveryHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [dayRows, setDayRows] = useState<AdminDelivery[] | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  const daysKey = selectedDays.slice().sort().join(",");
  const cells = useMemo(() => monthCells(year, month), [year, month]);

  const loadHistory = useCallback(async (y: number, m: number) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await adminApi.deliveryHistory(y, m);
      setHistory(data);
    } catch (e) {
      setHistory(null);
      setHistoryError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory(year, month);
  }, [year, month, loadHistory]);

  const load = useCallback(async () => {
    if (selectedDays.length === 0) {
      setRows([]);
      setCouriers({});
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setError(null);
    setRefreshing(true);
    try {
      const list = await adminApi.deliveries({
        days: daysKey,
        status: status || undefined,
        pageSize: 500,
      });
      setRows(list);
      setCouriers(Object.fromEntries(list.map((d) => [d.id, d.courierName ?? ""])));
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Ачаалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [daysKey, selectedDays.length, status, toast]);

  useEffect(() => {
    if (tab !== "send") return;
    void load();
  }, [load, tab]);

  useEffect(() => {
    if (!history) return;
    if (openDate && history.days.some((d) => d.date === openDate)) return;
    setOpenDate(history.days[0]?.date ?? null);
  }, [history, openDate]);

  const openHistoryDay = useCallback(
    async (date: string) => {
      setOpenDate(date);
      setDayLoading(true);
      try {
        setDayRows(await adminApi.deliveries({ day: date, pageSize: 200 }));
      } catch (e) {
        setDayRows([]);
        toast.error(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
      } finally {
        setDayLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (tab !== "history" || !openDate) return;
    void openHistoryDay(openDate);
  }, [tab, openDate, openHistoryDay]);

  const byDate = useMemo(() => {
    const map = new Map<string, DeliveryHistory["days"][number]>();
    for (const d of history?.days ?? []) map.set(d.date, d);
    return map;
  }, [history]);

  const selectableDates = history?.days.map((d) => d.date) ?? [];

  const workRows = useMemo(
    () => (status === "DELIVERED" ? rows : rows.filter((r) => r.status !== "DELIVERED")),
    [rows, status],
  );

  const visibleRows = useMemo(() => {
    const zoned = zoneFilter ? workRows.filter((r) => placeZone(r.district) === zoneFilter) : workRows;
    if (selectedDistricts.size === 0) return zoned;
    return zoned.filter((r) => selectedDistricts.has(r.district));
  }, [workRows, zoneFilter, selectedDistricts]);

  const groups = useMemo(() => groupDeliveriesByDistrict(visibleRows), [visibleRows]);
  const zones = useMemo(() => splitDeliveryZones(groups), [groups]);
  const allGroups = useMemo(() => groupDeliveriesByDistrict(workRows), [workRows]);
  const allZones = useMemo(() => splitDeliveryZones(allGroups), [allGroups]);

  const pending = workRows.length;
  const cityCount = workRows.filter((r) => placeZone(r.district) === "city").length;
  const aimagCount = workRows.filter((r) => placeZone(r.district) === "aimag").length;

  const toggleDay = (date: string) => {
    if (!byDate.has(date) && !selectedDays.includes(date)) return;
    setSelectedDays((prev) => {
      const next = prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date].sort();
      return next;
    });
    setSelectedDistricts(new Set());
  };

  const toggleDistrict = (district: string) => {
    setSelectedDistricts((prev) => {
      const next = new Set(prev);
      if (next.has(district)) next.delete(district);
      else next.add(district);
      return next;
    });
  };

  const save = async (id: string, patch: { courierName?: string | null; status?: string }) => {
    setBusy(id);
    setError(null);
    try {
      await adminApi.updateDelivery(id, patch);
      setRows((prev) =>
        prev.map((r) =>
          r.id !== id
            ? r
            : {
                ...r,
                courierName: patch.courierName !== undefined ? patch.courierName : r.courierName,
                status: (patch.status as DeliveryStatus | undefined) ?? r.status,
              },
        ),
      );
      toast.success(
        patch.status
          ? `Төлөв «${DELIVERY_STATUS_LABEL[patch.status as DeliveryStatus]}» боллоо.`
          : "Хүргэлт хадгалагдлаа.",
      );
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const printOpts = { days: selectedDays };
  const printSelection = () => {
    if (visibleRows.length === 0) {
      toast.error("Хэвлэх хүргэлт алга.");
      return;
    }
    printDeliveries(visibleRows, printOpts);
  };

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
          onCourier={(id, v) => setCouriers((prev) => ({ ...prev, [id]: v }))}
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
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
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
                      onClick={() => toggleDay(date)}
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
              onCourier={(id, v) => setCouriers((prev) => ({ ...prev, [id]: v }))}
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

function HistoryPanel({
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
          options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
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

function DeliveryList({
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

function DeliveryCard({
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
