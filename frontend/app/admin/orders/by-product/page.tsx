"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Metric, PageHead, ProductStatusBadge } from "@/components/admin/shared";
import { OrderDetail } from "@/components/admin/OrderDetail";
import { RoundBuyers } from "@/components/admin/RoundBuyers";
import { ProductImage } from "@/components/ProductImage";
import { Button, Card, Empty, ErrorNote, Input, Skeleton } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import {
  closeHint,
  DEFAULT_PRODUCT_PRINT,
  downloadProductOrdersExcel,
  printProductOrders,
  productExcelFilename,
  roundOrdersToPrintProduct,
  rowToPrintProduct,
  type ProductPrintOptions,
} from "@/lib/roundPrint";
import type { OrdersByProductDate, OrdersByProductRow } from "@/lib/types";

type ClosedFilter = "all" | "open" | "closed";

const CLOSED_TABS: { value: ClosedFilter; label: string }[] = [
  { value: "closed", label: "Хаагдсан" },
  { value: "open", label: "Хаагдаагүй" },
  { value: "all", label: "Бүгд" },
];

export default function OrdersByProductPage() {
  const [closed, setClosed] = useState<ClosedFilter>("closed");
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [dates, setDates] = useState<OrdersByProductDate[]>([]);
  const [rows, setRows] = useState<OrdersByProductRow[]>([]);
  const [pageMeta, setPageMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openRoundId, setOpenRoundId] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printOpts, setPrintOpts] = useState<ProductPrintOptions>(DEFAULT_PRODUCT_PRINT);
  const [printBusy, setPrintBusy] = useState<"print" | "excel" | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void (async () => {
      try {
        setDates(await adminApi.ordersByProductDates(closed));
      } catch {
        setDates([]);
      }
    })();
  }, [closed]);

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
        days: selectedDays.length ? selectedDays.join(",") : undefined,
        q: query || undefined,
        page,
        pageSize: 50,
      }),
    [closed, year, month, selectedDays, query],
  );

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const list = await fetchPage(1);
      setRows(list.data);
      setPageMeta({
        page: list.meta?.page ?? 1,
        pages: list.meta?.pages ?? 1,
        total: list.meta?.total ?? list.data.length,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    setMoreLoading(true);
    try {
      const list = await fetchPage(pageMeta.page + 1);
      setRows((prev) => [...prev, ...list.data]);
      setPageMeta({
        page: list.meta?.page ?? pageMeta.page + 1,
        pages: list.meta?.pages ?? pageMeta.pages,
        total: list.meta?.total ?? pageMeta.total,
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setMoreLoading(false);
    }
  };

  const pickYear = (y: number) => {
    setYear((prev) => (prev === y ? null : y));
    setMonth(null);
    setSelectedDays([]);
  };
  const pickMonth = (m: number) => {
    setMonth((prev) => (prev === m ? null : m));
    setSelectedDays([]);
  };
  const toggleDay = (d: number) => {
    setSelectedDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  };

  const runExport = async (mode: "print" | "excel") => {
    if (rows.length === 0) return;
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
        ? (await Promise.all(rows.map((row) => adminApi.roundOrders(row.roundId)))).map(
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
      setPrintBusy(null);
    }
  };

  if (openOrderId) {
    return (
      <OrderDetail
        orderId={openOrderId}
        onClose={() => setOpenOrderId(null)}
        onChanged={() => void load()}
      />
    );
  }

  if (openRoundId) {
    return (
      <RoundBuyers
        roundId={openRoundId}
        onClose={() => setOpenRoundId(null)}
        onOpenOrder={(orderId) => {
          setOpenRoundId(null);
          setOpenOrderId(orderId);
        }}
      />
    );
  }

  return (
    <div>
      <PageHead
        title="Бараагаар захиалга"
        hint="Хаагдсан болон нээлттэй гаргалтыг өнгө, хэмжээгээр нь харна."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={rows.length === 0 || printBusy != null}
              loading={printBusy != null}
              onClick={() => setPrintOpen((v) => !v)}
            >
              Хэвлэх / Excel
            </Button>
            <Link
              href="/admin"
              className="inline-flex h-9 items-center rounded-[8px] border border-line bg-bg px-3 text-[13px] text-ink no-underline"
            >
              Захиалгын жагсаалт
            </Link>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Metric label="Бараа" value={pageMeta.total} />
        <Metric
          label="Нийт ширхэг"
          value={rows.reduce((sum, r) => sum + r.qty, 0)}
          sub="Энэ хуудсан дээр"
        />
        <Metric
          label="Захиалга"
          value={rows.reduce((sum, r) => sum + r.orderCount, 0)}
          sub="Энэ хуудсан дээр"
        />
      </div>

      {printOpen && (
        <Card className="mb-4 flex flex-col gap-3 p-4">
          <div className="text-[14px] font-medium">Хэвлэх / Excel сонголт</div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Check
              checked={printOpts.customers}
              onChange={(v) =>
                setPrintOpts((o) => ({
                  ...o,
                  customers: v,
                  phone: v ? o.phone : false,
                  code: v ? o.code : false,
                }))
              }
            >
              Худалдан авагчид
            </Check>
            <Check
              checked={printOpts.phone}
              onChange={(v) => setPrintOpts((o) => ({ ...o, phone: v }))}
              disabled={!printOpts.customers}
            >
              Утас
            </Check>
            <Check
              checked={printOpts.code}
              onChange={(v) => setPrintOpts((o) => ({ ...o, code: v }))}
              disabled={!printOpts.customers}
            >
              Захиалгын код
            </Check>
            <Check
              checked={printOpts.amounts}
              onChange={(v) => setPrintOpts((o) => ({ ...o, amounts: v }))}
            >
              Үнэ
            </Check>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void runExport("print")}
              loading={printBusy === "print"}
              disabled={printBusy != null}
            >
              {printOpts.customers ? "Жагсаалтыг хэвлэх" : "Тоог хэвлэх"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runExport("excel")}
              loading={printBusy === "excel"}
              disabled={printBusy != null}
            >
              Excel татах
            </Button>
          </div>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {CLOSED_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => {
              setClosed(tab.value);
              setYear(null);
              setMonth(null);
              setSelectedDays([]);
            }}
            className={`h-10 cursor-pointer rounded-[8px] border px-3 text-[13px] ${
              closed === tab.value
                ? "border-ink bg-ink text-white"
                : "border-line bg-bg text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <div className="min-w-[200px] flex-1">
          <Input value={search} onChange={setSearch} placeholder="Барааны нэр" />
        </div>
      </div>

      {years.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 text-[12px] text-muted">Он</div>
          <div className="flex flex-wrap gap-1.5">
            {years.map((y) => (
              <Chip key={y} active={year === y} onClick={() => pickYear(y)}>
                {y}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {months.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 text-[12px] text-muted">Сар</div>
          <div className="flex flex-wrap gap-1.5">
            {months.map((m) => (
              <Chip key={m} active={month === m} onClick={() => pickMonth(m)}>
                {m}-р сар
              </Chip>
            ))}
          </div>
        </div>
      )}
      {dayOptions.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[12px] text-muted">
              Өдөр
              {selectedDays.length > 0 ? ` · ${selectedDays.length} сонгосон` : " · олон өдөр дарж сонгоно"}
            </div>
            <button
              type="button"
              onClick={() =>
                setSelectedDays(
                  selectedDays.length === dayOptions.length
                    ? []
                    : dayOptions.map((d) => d.day),
                )
              }
              className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-ink-2 underline"
            >
              {selectedDays.length === dayOptions.length ? "Арилгах" : "Бүгдийг сонгох"}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dayOptions.map((d) => (
              <Chip key={d.date} active={selectedDays.includes(d.day)} onClick={() => toggleDay(d.day)}>
                {d.day}
                <span className="ml-1 text-[11px] opacity-70">{d.count}</span>
              </Chip>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-[12px]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty>Энэ шүүлтээр захиалгатай бараа алга.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <button
              key={row.roundId}
              type="button"
              onClick={() => setOpenRoundId(row.roundId)}
              className="cursor-pointer rounded-[12px] border border-line bg-bg p-4 text-left transition-colors hover:border-primary-muted"
            >
              <div className="flex items-start gap-3">
                <ProductImage
                  src={row.image}
                  alt={row.name}
                  className="h-14 w-14 shrink-0 rounded-[8px]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[15px] font-medium">{row.name}</div>
                      <div className="mt-0.5 text-[13px] text-ink-2">
                        #{row.roundNo} гаргалт · {closeHint(row)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ProductStatusBadge status={row.status} />
                      <span className="tnum text-[18px] font-medium">{row.qty} ш</span>
                    </div>
                  </div>
                  <div className="mt-2 text-[13px] text-ink-2">
                    {row.customerCount} хүн · {row.orderCount} захиалга · {money(row.revenue)}
                  </div>
                  {row.byKind.length > 0 && (
                    <div className="mt-3 flex flex-col gap-2">
                      {row.byKind.map((kind) => (
                        <div key={kind.kind}>
                          <div className="mb-1 text-[12px] text-muted">{kind.kind}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {kind.rows.map((r) => (
                              <span
                                key={r.value}
                                className="rounded-[8px] border border-line bg-surface px-2.5 py-1 text-[13px]"
                              >
                                {r.value}{" "}
                                <span className="tnum font-medium">{r.qty}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {row.byVariant.length > 0 && (
                    <div className="mt-3 text-[13px] text-ink-2">
                      {row.byVariant
                        .slice(0, 8)
                        .map((v) => {
                          const label =
                            formatSelections(v.selections, v.size, v.color) || "Сонголтгүй";
                          return `${label} ${v.qty}ш`;
                        })
                        .join(" · ")}
                      {row.byVariant.length > 8 ? " …" : ""}
                    </div>
                  )}
                </div>
              </div>
            </button>
          ))}
          {pageMeta.page < pageMeta.pages && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => void loadMore()} loading={moreLoading}>
                Цааш үзэх · {pageMeta.total - rows.length} бараа
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
      className={`h-9 cursor-pointer rounded-[8px] border px-3 text-[13px] ${
        active ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Check({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  children: string;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-[13px] ${
        disabled ? "cursor-not-allowed text-muted" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}
