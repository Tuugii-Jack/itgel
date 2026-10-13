"use client";

import { deferEffect } from "@/lib/deferEffect";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Metric, PageHead } from "@/components/admin/shared";
import { OrderDetail } from "@/components/admin/OrderDetail";
import { RoundBuyers } from "@/components/admin/RoundBuyers";
import { ProductOrderCard } from "@/features/orders/components/ProductOrderCard";
import { ProductOrderExport } from "@/features/orders/components/ProductOrderExport";
import { productOrderDateFilters, mapProductOrderExport } from "@/features/orders/productOrderView";
import { SearchField } from "@/components/admin/SearchField";
import { TaskTabs } from "@/components/admin/TaskTabs";
import { updateWorkspaceQuery, useWorkspaceQuery } from "@/lib/useWorkspaceQuery";
import { CalendarDays, ChevronRight, RotateCcw } from "lucide-react";
import { Button, Card, Empty, ErrorNote, Skeleton } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import {
  DEFAULT_PRODUCT_PRINT,
  downloadProductOrdersExcel,
  printProductOrders,
  productExcelFilename,
  roundOrdersToPrintProduct,
  rowToPrintProduct,
  type ProductPrintOptions,
} from "@/lib/roundPrint";
import type { OrdersByProductDate, OrdersByProductRow } from "@/lib/types";
import { useDeferredReload } from "@/lib/useDeferredReload";

type ClosedFilter = "all" | "open" | "closed";

const CLOSED_TABS: { value: ClosedFilter; label: string }[] = [
  { value: "closed", label: "Хаагдсан" },
  { value: "open", label: "Хаагдаагүй" },
  { value: "all", label: "Бүгд" },
];

export default function OrdersByProductPage() {
  const [closedRaw] = useWorkspaceQuery("closed", "closed");
  const closed: ClosedFilter = closedRaw === "all" || closedRaw === "open" ? closedRaw : "closed";
  const [yearRaw] = useWorkspaceQuery("year");
  const [monthRaw] = useWorkspaceQuery("month");
  const [daysRaw] = useWorkspaceQuery("days");
  const dateFilters = useMemo(() => productOrderDateFilters(yearRaw, monthRaw, daysRaw), [yearRaw, monthRaw, daysRaw]);
  const { year, month, days: selectedDays } = dateFilters;
  const daysKey = useMemo(() => dateFilters.days.join(","), [dateFilters]);
  const [search, setSearch] = useWorkspaceQuery("q", "", true);
  const [query, setQuery] = useState(search.trim().slice(0, 80));
  const [dates, setDates] = useState<OrdersByProductDate[]>([]);
  const [rows, setRows] = useState<OrdersByProductRow[]>([]);
  const [pageMeta, setPageMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRoundId, setOpenRoundId] = useWorkspaceQuery("round");
  const [openOrderId, setOpenOrderId] = useWorkspaceQuery("order");
  const [printOpen, setPrintOpen] = useState(false);
  const [printOpts, setPrintOpts] = useState<ProductPrintOptions>(DEFAULT_PRODUCT_PRINT);
  const [printBusy, setPrintBusy] = useState<"print" | "excel" | null>(null);

  const requests = useRef(0);
  const moreInFlight = useRef(false);
  const exportInFlight = useRef(false);
  const [datesLoading, setDatesLoading] = useState(true);
  const [datesError, setDatesError] = useState(false);
  const [datesReload, setDatesReload] = useState(0);
  const listScope = [closed, year, month, daysKey, query].join("|");
  const [loadedScope, setLoadedScope] = useState("");
  const listLoading = loading || loadedScope !== listScope;
  const clearDate = () => updateWorkspaceQuery({ year: null, month: null, days: null });
  const clearFilters = () => { updateWorkspaceQuery({ year: null, month: null, days: null, q: null }); setQuery(""); };
  const setSelectedDays = (days: number[]) => updateWorkspaceQuery({ days: days.length ? days.join(",") : null });

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim().slice(0, 80)), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    const cancel = deferEffect(() => {
      setDatesLoading(true); setDatesError(false); setDates([]);
      void adminApi.ordersByProductDates(closed).then((value) => { if (active) setDates(value); })
        .catch(() => { if (active) setDatesError(true); })
        .finally(() => { if (active) setDatesLoading(false); });
    });
    return () => { active = false; cancel(); };
  }, [closed, datesReload]);

  const years = useMemo(() => [...new Set(dates.map((d) => d.year))].sort((a, b) => b - a), [dates]);
  const months = useMemo(
    () =>
      year == null
        ? []
        : [...new Set(dates.filter((d) => d.year === year).map((d) => d.month))].sort(
            (a, b) => a - b,
          ),
    [dates, year],
  );
  const dayOptions = useMemo(
    () =>
      year == null || month == null
        ? []
        : dates
            .filter((d) => d.year === year && d.month === month)
            .sort((a, b) => a.day - b.day),
    [dates, year, month],
  );

  const fetchPage = useCallback(
    (page: number) =>
      adminApi.ordersByProduct({
        closed,
        year: year ?? undefined,
        month: month ?? undefined,
        days: daysKey || undefined,
        q: query || undefined,
        page,
        pageSize: 50,
      }),
    [closed, year, month, daysKey, query],
  );

  const load = useCallback(async () => {
    const generation = ++requests.current;
    moreInFlight.current = false; setMoreLoading(false);
    setError(null);
    setLoading(true);
    try {
      const list = await fetchPage(1);
      if (generation !== requests.current) return;
      setRows(list.data);
      setPageMeta({
        page: list.meta?.page ?? 1,
        pages: list.meta?.pages ?? 1,
        total: list.meta?.total ?? list.data.length,
      });
    } catch (e) {
      if (generation !== requests.current) return;
      setRows([]);
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      if (generation === requests.current) { setLoading(false); setLoadedScope(listScope); }
    }
  }, [fetchPage, listScope]);

  const markChanged = useDeferredReload(load, !openOrderId && !openRoundId);

  useEffect(() => {
    const current = requests; const cancel = deferEffect(() => { void load(); });
    return () => { cancel(); current.current++; };
  }, [load]);

  const loadMore = async () => {
    if (moreInFlight.current || listLoading || pageMeta.page >= pageMeta.pages) return;
    const generation = requests.current; moreInFlight.current = true;
    setMoreLoading(true);
    try {
      const list = await fetchPage(pageMeta.page + 1);
      if (generation !== requests.current) return;
      setRows((prev) => [...prev, ...list.data.filter((row) => !prev.some((existing) => existing.roundId === row.roundId))]);
      setPageMeta({
        page: list.meta?.page ?? pageMeta.page + 1,
        pages: list.meta?.pages ?? pageMeta.pages,
        total: list.meta?.total ?? pageMeta.total,
      });
    } catch (e) {
      if (generation === requests.current) setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      if (generation === requests.current) { setMoreLoading(false); moreInFlight.current = false; }
    }
  };

  const pickYear = (value: number) => updateWorkspaceQuery({ year: year === value ? null : String(value), month: null, days: null });
  const pickMonth = (value: number) => updateWorkspaceQuery({ month: month === value ? null : String(value), days: null });
  const toggleDay = (value: number) => setSelectedDays(selectedDays.includes(value) ? selectedDays.filter((day) => day !== value) : [...selectedDays, value].sort((a, b) => a - b));

  const runExport = async (mode: "print" | "excel") => {
    if (rows.length === 0 || listLoading || moreLoading || exportInFlight.current) return;
    exportInFlight.current = true;
    setPrintBusy(mode);
    const title =
      closed === "closed"
        ? "Хаагдсан бараа"
        : closed === "open"
          ? "Хаагдаагүй бараа"
          : "Бараагаар захиалга";
    const hint = [
      year && month && selectedDays.length > 0
        ? `${year} оны ${month}-р сарын ${selectedDays.join(", ")}`
        : year && month
          ? `${year} оны ${month}-р сар`
          : year
            ? `${year} он`
            : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const meta = { title, hint: hint || undefined };
    try {
      const products = printOpts.customers
        ? (await mapProductOrderExport(rows, (row) => adminApi.roundOrders(row.roundId))).map(
            roundOrdersToPrintProduct,
          )
        : rows.map(rowToPrintProduct);
      if (mode === "excel") {
        downloadProductOrdersExcel(products, printOpts, {
          filename: productExcelFilename(title),
        });
        return;
      }
      printProductOrders(products, printOpts, meta);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : mode === "excel"
            ? "Excel татаж чадсангүй."
            : "Хэвлэж чадсангүй.",
      );
    } finally {
      exportInFlight.current = false;
      setPrintBusy(null);
    }
  };

  if (openOrderId) {
    return (
      <OrderDetail
        orderId={openOrderId}
        workspace="shop"
        backLabel={openRoundId ? "Барааны захиалга руу" : "Бараагаар захиалга руу"}
        onClose={() => setOpenOrderId(null)}
        onChanged={markChanged}
      />
    );
  }

  if (openRoundId) {
    return (
      <RoundBuyers
        roundId={openRoundId}
        onClose={() => setOpenRoundId(null)}
        onOpenOrder={(orderId) => {
          setOpenOrderId(orderId);
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHead
        title="Бараагаар захиалга"
        hint="Барааны тоо, өнгө/хэмжээ, худалдан авагчдыг нэг дор."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={rows.length === 0 || listLoading || moreLoading || printBusy != null}
              loading={printBusy != null}
              aria-expanded={printOpen}
              onClick={() => setPrintOpen((v) => !v)}
            >
              Хэвлэх / Excel
            </Button>
            <Link
              href="/workspace/shop"
              className="inline-flex h-9 items-center rounded-[8px] border border-line bg-bg px-3 text-[13px] text-ink no-underline"
            >
              Захиалгын жагсаалт
            </Link>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Metric label="Захиалгатай гаргалт" value={listLoading ? "…" : pageMeta.total} sub="Одоогийн шүүлтийн нийт" />
        <Metric
          label="Нийт ширхэг"
          value={listLoading ? "…" : rows.reduce((sum, r) => sum + r.qty, 0)}
          sub="Харагдаж буй гаргалтууд"
        />
        <Metric
          label="Барааны нийт дүн"
          value={listLoading ? "…" : money(rows.reduce((sum, r) => sum + r.revenue, 0))}
          sub="Харагдаж буй · орсон төлбөр биш"
        />
      </div>

      {printOpen && <ProductOrderExport options={printOpts} onChange={setPrintOpts} busy={printBusy}
        disabled={listLoading || moreLoading || rows.length === 0} onExport={(mode) => void runExport(mode)}
        scopeLabel={"Харагдаж буй " + rows.length + " гаргалтыг хэвлэнэ. Дараагийн хуудсыг ачаалаагүй бол экспортод орохгүй."} />}

      <TaskTabs value={closed} onChange={(value) => updateWorkspaceQuery({ closed: value === "closed" ? null : value, year: null, month: null, days: null })} items={CLOSED_TABS.map((tab) => ({ id: tab.value, label: tab.label }))} label="Гаргалтын шүүлт" />
      <Card className="mb-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <SearchField value={search} onChange={setSearch} maxLength={80} placeholder="Барааны нэрээр хайх" className="min-w-48 flex-1" />
          <Button size="sm" variant="outline" disabled={!search && year === null} onClick={clearFilters}><RotateCcw className="h-4 w-4" aria-hidden="true" />Цэвэрлэх</Button>
        </div>
        <details key={closed} open={year !== null} className="group mt-4 border-t border-line pt-4">
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-[13px] font-medium"><CalendarDays className="h-4 w-4 text-muted" aria-hidden="true" />Хаагдах огноогоор шүүх<span className="font-normal text-muted">{year !== null ? year + (month !== null ? " · " + month + "-р сар" : "") + (selectedDays.length ? " · " + selectedDays.join(", ") + "-ны өдөр" : "") : "Он → сар → өдөр"}</span><ChevronRight className="ml-auto h-4 w-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" /></summary>
          <p className="mb-3 mt-2 text-[12px] text-muted">Гаргалтын хаагдах огноогоор шүүнэ. Бэлэн бараа огноогүй тул огноо сонгоход харагдахгүй. Олон өдөр сонгож болно.</p>
          {datesLoading ? <Skeleton className="h-10 rounded-lg" /> : datesError ? <div className="flex flex-wrap items-center gap-3 text-[13px] text-warn">Огнооны сонголт ачаалсангүй.<Button size="sm" variant="outline" onClick={() => setDatesReload((value) => value + 1)}>Дахин ачаалах</Button></div> : years.length === 0 ? <p className="text-[13px] text-muted">Огноотой гаргалт алга.</p> : <div className="space-y-4">
            <div><div className="mb-2 text-[12px] text-muted">Он</div><div className="flex flex-wrap gap-2">{years.map((value) => <Chip key={value} active={year === value} onClick={() => pickYear(value)}>{value}</Chip>)}</div></div>
            {months.length > 0 && <div><div className="mb-2 text-[12px] text-muted">Сар</div><div className="flex flex-wrap gap-2">{months.map((value) => <Chip key={value} active={month === value} onClick={() => pickMonth(value)}>{value}-р сар</Chip>)}</div></div>}
            {dayOptions.length > 0 && <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="text-[12px] text-muted">Өдөр · жижиг тоо нь гаргалтын тоо</span><button type="button" onClick={() => setSelectedDays(dayOptions.every((day) => selectedDays.includes(day.day)) ? [] : dayOptions.map((day) => day.day))} className="min-h-9 text-[12px] text-secondary underline">{dayOptions.every((day) => selectedDays.includes(day.day)) ? "Өдрүүдийг арилгах" : "Бүх өдрийг сонгох"}</button></div><div className="flex flex-wrap gap-2">{dayOptions.map((day) => <Chip key={day.date} active={selectedDays.includes(day.day)} onClick={() => toggleDay(day.day)}>{day.day}<span className="ml-2 text-[11px] opacity-70">{day.count}</span></Chip>)}</div></div>}
          </div>}
          {year !== null && <Button size="sm" variant="ghost" className="mt-3" onClick={clearDate}>Огноог цэвэрлэх</Button>}
        </details>
      </Card>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote><Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>Дахин ачаалах</Button>
        </div>
      )}

      {listLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-[12px]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty>Энэ шүүлтээр захиалгатай бараа алга.<Button size="sm" variant="outline" className="mt-3" onClick={clearFilters}>Хайлт, огноог цэвэрлэх</Button></Empty>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted"><span>{rows.length} / {pageMeta.total} гаргалт харагдаж байна</span><span>Нэр эсвэл “Дэлгэрэнгүй” дээр дарж нээнэ</span></div>
          {rows.map((row) => <ProductOrderCard key={row.roundId} row={row} onOpen={() => setOpenRoundId(row.roundId)} />)}
          {pageMeta.page < pageMeta.pages && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => void loadMore()} loading={moreLoading}>
                Цааш үзэх · {Math.max(0, pageMeta.total - rows.length)} гаргалт
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-9 cursor-pointer rounded-[8px] border px-3 text-[13px] ${
        active ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"
      }`}
    >
      {children}
    </button>
  );
}
