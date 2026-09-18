"use client";

import { useEffect, useMemo, useState } from "react";
import { Metric, PageHead, Table, Td, Th } from "@/components/admin/shared";
import { Button, Card, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { money, monthLabel, num } from "@/lib/format";
import type { AdminProduct, ProductReportRow, RevenueReport } from "@/lib/types";

const PERIODS: { value: "3m" | "6m" | "1y"; label: string }[] = [
  { value: "3m", label: "3 сар" },
  { value: "6m", label: "6 сар" },
  { value: "1y", label: "1 жил" },
];

type View = "all" | "sold" | "returned";

function emptyRow(product: AdminProduct): ProductReportRow {
  return {
    productId: product.id,
    name: product.name,
    category: product.category?.name ?? null,
    soldQty: 0,
    soldAmount: 0,
    returnedQty: 0,
    returnedAmount: 0,
    netQty: 0,
    netAmount: 0,
    sellPrice: product.currentRound?.sellPrice ?? 0,
  };
}

function mergeCatalog(report: ProductReportRow[], products: AdminProduct[]): ProductReportRow[] {
  const byId = new Map(report.map((row) => [row.productId, row]));
  for (const product of products) {
    if (!byId.has(product.id)) byId.set(product.id, emptyRow(product));
  }
  return [...byId.values()].sort(
    (a, b) =>
      b.soldAmount - a.soldAmount ||
      b.returnedAmount - a.returnedAmount ||
      a.name.localeCompare(b.name, "mn"),
  );
}

function matchesQuery(row: ProductReportRow, needle: string): boolean {
  if (!needle) return true;
  return (
    row.name.toLowerCase().includes(needle) ||
    (row.category ?? "").toLowerCase().includes(needle)
  );
}

export default function ReportsPage() {
  const [period, setPeriod] = useState<"3m" | "6m" | "1y">("6m");
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [catalog, setCatalog] = useState<ProductReportRow[]>([]);
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedKey = useMemo(() => [...selected].sort().join(","), [selected]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      setRefreshing(true);
      try {
        const [report, list] = await Promise.all([
          adminApi.productReport(period, 300),
          adminApi.products({ page: 1, pageSize: 100 }),
        ]);
        if (cancelled) return;
        const merged = mergeCatalog(report, list.data);
        setCatalog(merged);
        setSelected((prev) => {
          const ids = new Set(merged.map((row) => row.productId));
          let changed = false;
          const next = new Set<string>();
          for (const id of prev) {
            if (ids.has(id)) next.add(id);
            else changed = true;
          }
          return changed ? next : prev;
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const ids = selectedKey ? selectedKey.split(",") : undefined;
        const next = await adminApi.revenue(period, ids);
        if (!cancelled) setRevenue(next);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period, selectedKey]);

  const needle = query.trim().toLowerCase();
  const activeRows = useMemo(
    () => catalog.filter((row) => row.soldQty > 0 || row.returnedQty > 0),
    [catalog],
  );

  const pickerRows = useMemo(() => {
    const source = needle ? catalog : activeRows.length > 0 ? activeRows : catalog;
    const filtered = source.filter((row) => matchesQuery(row, needle));
    const selectedRows = catalog.filter((row) => selected.has(row.productId));
    const rest = filtered.filter((row) => !selected.has(row.productId));
    const seen = new Set<string>();
    const out: ProductReportRow[] = [];
    for (const row of [...selectedRows, ...rest]) {
      if (seen.has(row.productId)) continue;
      if (!matchesQuery(row, needle) && !selected.has(row.productId)) continue;
      seen.add(row.productId);
      out.push(row);
    }
    return out;
  }, [catalog, activeRows, needle, selected]);

  const tableRows = useMemo(() => {
    const base =
      selected.size === 0 ? catalog : catalog.filter((row) => selected.has(row.productId));
    const filtered = base.filter((row) => matchesQuery(row, needle));
    if (view === "sold") return filtered.filter((row) => row.soldQty > 0);
    if (view === "returned") return filtered.filter((row) => row.returnedQty > 0);
    return filtered.filter((row) => selected.size > 0 || row.soldQty > 0 || row.returnedQty > 0);
  }, [catalog, selected, needle, view]);

  const max = revenue ? Math.max(1, ...revenue.series.map((s) => Math.max(s.sold, s.returned))) : 1;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <PageHead
        title="Тайлан"
        hint="Зөвхөн зарах үнэ. Бараа эсвэл буцаалт сонгоод хэр их зарагдсаныг харна."
        actions={
          <div className="flex items-center gap-2">
            {PERIODS.map((p) => (
              <Button
                key={p.value}
                size="sm"
                variant={period === p.value ? "primary" : "outline"}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
            {refreshing && <span className="text-[13px] text-muted">Шинэчилж байна…</span>}
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading && !revenue ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-muted" />
        </div>
      ) : !revenue ? (
        <Empty>Мэдээлэл алга.</Empty>
      ) : (
        <>
          <Card className="mb-5 p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-[15px] font-medium">Бараа, буцаалт</div>
                <div className="mt-0.5 text-[13px] text-muted">
                  {selected.size === 0
                    ? "Сонгоогүй бол бүх бараа. Товч дарж шүүнэ."
                    : `${selected.size} бараа сонгосон`}
                </div>
              </div>
              {catalog.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setSelected(
                      selected.size === catalog.length
                        ? new Set()
                        : new Set(catalog.map((r) => r.productId)),
                    )
                  }
                  className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-ink-2 underline"
                >
                  {selected.size === catalog.length ? "Арилгах" : "Бүгдийг сонгох"}
                </button>
              )}
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              {(
                [
                  { key: "all" as const, label: "Бүгд" },
                  { key: "sold" as const, label: "Зарагдсан" },
                  { key: "returned" as const, label: "Буцаалт" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setView(t.key)}
                  className={`h-9 cursor-pointer rounded-[8px] border px-3 text-[13px] ${
                    view === t.key ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="mb-3 max-w-[320px]">
              <Input value={query} onChange={setQuery} placeholder="Бараа хайх" />
            </div>
            {pickerRows.length === 0 ? (
              <div className="text-[13px] text-muted">Энэ хугацаанд бараа алга.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {pickerRows.map((row) => {
                  const on = selected.has(row.productId);
                  return (
                    <button
                      key={row.productId}
                      type="button"
                      onClick={() => toggle(row.productId)}
                      className={`cursor-pointer rounded-[8px] border px-3 py-2 text-left ${
                        on
                          ? "border-ink bg-ink text-white"
                          : "border-line bg-bg text-ink hover:border-primary-muted"
                      }`}
                    >
                      <div className="text-[13px] font-medium">{row.name}</div>
                      <div className={`tnum text-[12px] ${on ? "opacity-80" : "text-muted"}`}>
                        {row.soldQty} зарсан
                        {row.returnedQty > 0 ? ` · ${row.returnedQty} буцаалт` : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              label="Борлуулалт"
              value={money(revenue.totals.sold)}
              sub={`${num(revenue.totals.soldQty)} ш`}
            />
            <Metric
              label="Буцаалт"
              value={money(revenue.totals.returned)}
              tone="warn"
              sub={`${num(revenue.totals.returnedQty)} ш`}
            />
            <Metric label="Цэвэр" value={money(revenue.totals.net)} tone="ok" />
            <Metric label="Захиалга" value={revenue.totals.orders} />
          </div>

          <Card className="mb-5 p-4">
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <span className="text-[15px] font-medium">Сарын борлуулалт</span>
              <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-ink" />
                Зарагдсан
              </span>
              <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-warn" />
                Буцаалт
              </span>
            </div>

            <div className="flex items-end gap-2 overflow-x-auto pb-1">
              {revenue.series.map((row) => (
                <div key={row.month} className="flex min-w-[56px] flex-1 flex-col items-center gap-1.5">
                  <span className="tnum text-[12px] text-ink-2">
                    {row.sold > 0 ? `${Math.round(row.sold / 1000)}к` : "—"}
                  </span>
                  <div className="flex h-[140px] w-full items-end justify-center gap-1">
                    <div
                      className="w-1/2 rounded-t-[3px] bg-ink"
                      style={{
                        height: row.sold <= 0 ? 0 : `${Math.max(2, (row.sold / max) * 100)}%`,
                      }}
                      title={`Зарагдсан ${money(row.sold)}`}
                    />
                    <div
                      className="w-1/2 rounded-t-[3px] bg-warn"
                      style={{
                        height:
                          row.returned <= 0 ? 0 : `${Math.max(2, (row.returned / max) * 100)}%`,
                      }}
                      title={`Буцаалт ${money(row.returned)}`}
                    />
                  </div>
                  <span className="text-[12px] text-muted">{monthLabel(row.month)}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="mb-2 text-[15px] font-medium">Бараагаар</div>
          {tableRows.length === 0 ? (
            <Empty>Сонголтод таарах бараа алга.</Empty>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <thead>
                    <tr>
                      <Th>Бараа</Th>
                      <Th>Ангилал</Th>
                      <Th>Зарах үнэ</Th>
                      <Th>Зарагдсан</Th>
                      <Th>Буцаалт</Th>
                      <Th>Цэвэр дүн</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row) => (
                      <tr key={row.productId}>
                        <Td>{row.name}</Td>
                        <Td className="text-[13px] text-ink-2">{row.category ?? "—"}</Td>
                        <Td className="tnum">{row.sellPrice > 0 ? money(row.sellPrice) : "—"}</Td>
                        <Td>
                          <div className="tnum">{num(row.soldQty)} ш</div>
                          <div className="tnum text-[13px] text-ink-2">{money(row.soldAmount)}</div>
                        </Td>
                        <Td>
                          {row.returnedQty > 0 ? (
                            <>
                              <div className="tnum">{num(row.returnedQty)} ш</div>
                              <div className="tnum text-[13px] text-ink-2">
                                {money(row.returnedAmount)}
                              </div>
                            </>
                          ) : (
                            "—"
                          )}
                        </Td>
                        <Td className="tnum">{money(row.netAmount)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>

              <div className="flex flex-col gap-3 md:hidden">
                {tableRows.map((row) => (
                  <Card key={row.productId} className="p-4">
                    <div className="text-[14px] leading-[1.4]">{row.name}</div>
                    <div className="text-[13px] text-muted">{row.category ?? "—"}</div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[13px]">
                      <div>
                        <div className="text-muted">Зарсан</div>
                        <div className="tnum">{num(row.soldQty)} ш</div>
                        <div className="tnum text-ink-2">{money(row.soldAmount)}</div>
                      </div>
                      <div>
                        <div className="text-muted">Буцаалт</div>
                        <div className="tnum">{num(row.returnedQty)} ш</div>
                        <div className="tnum text-ink-2">
                          {row.returnedQty > 0 ? money(row.returnedAmount) : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted">Цэвэр</div>
                        <div className="tnum">{money(row.netAmount)}</div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
