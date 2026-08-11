"use client";

import { useCallback, useEffect, useState } from "react";
import { Metric, PageHead, Table, Td, Th } from "@/components/admin/shared";
import { Badge, Button, Card, Empty, ErrorNote, Spinner } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { money, monthLabel, num } from "@/lib/format";
import type { ProductReportRow, RevenueReport } from "@/lib/types";

const PERIODS: { value: "3m" | "6m" | "1y"; label: string }[] = [
  { value: "3m", label: "3 сар" },
  { value: "6m", label: "6 сар" },
  { value: "1y", label: "1 жил" },
];

export default function ReportsPage() {
  const [period, setPeriod] = useState<"3m" | "6m" | "1y">("6m");
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [products, setProducts] = useState<ProductReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const [r, p] = await Promise.all([
        adminApi.revenue(period),
        adminApi.productReport(period, 20),
      ]);
      setRevenue(r);
      setProducts(p);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const max = revenue ? Math.max(1, ...revenue.series.map((s) => s.revenue)) : 1;

  return (
    <div>
      <PageHead
        title="Тайлан, орлого"
        hint="Анхны үнэ ба зарах үнийн зөрүүгээр бодсон. Зөвхөн хүлээлгэн өгсөн захиалга."
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
            {refreshing && (
              <span className="text-[13px] text-muted">Шинэчилж байна…</span>
            )}
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
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Борлуулалт" value={money(revenue.totals.revenue)} />
            <Metric label="Ашиг" value={money(revenue.totals.profit)} tone="ok" />
            <Metric
              label="Ашгийн хувь"
              value={`${revenue.totals.marginPercent}%`}
              sub={`${revenue.totals.orders} захиалга`}
            />
            <Metric
              label="Дундаж захиалга"
              value={money(revenue.totals.averageOrderValue)}
            />
          </div>

          <Card className="mb-5 p-4">
            <div className="mb-4 flex flex-wrap items-center gap-4">
              <span className="text-[15px] font-medium">Сарын борлуулалт</span>
              <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-ink" />
                Борлуулалт
              </span>
              <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-muted" />
                Ашиг
              </span>
            </div>

            <div className="flex items-end gap-2 overflow-x-auto pb-1">
              {revenue.series.map((row) => (
                <div key={row.month} className="flex min-w-[56px] flex-1 flex-col items-center gap-1.5">
                  <span className="tnum text-[12px] text-ink-2">
                    {row.revenue > 0 ? `${Math.round(row.revenue / 1000)}к` : "—"}
                  </span>
                  <div className="flex h-[140px] w-full items-end justify-center gap-1">
                    <div
                      className="w-1/2 rounded-t-[3px] bg-ink"
                      style={{ height: `${Math.max(2, (row.revenue / max) * 100)}%` }}
                      title={`Борлуулалт ${money(row.revenue)}`}
                    />
                    <div
                      className="w-1/2 rounded-t-[3px] bg-muted"
                      style={{ height: `${Math.max(2, (row.profit / max) * 100)}%` }}
                      title={`Ашиг ${money(row.profit)}`}
                    />
                  </div>
                  <span className="text-[12px] text-muted">{monthLabel(row.month)}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="mb-2 text-[15px] font-medium">Ашиг өндөртэй бараа</div>
          {products.length === 0 ? (
            <Empty>Энэ хугацаанд хүлээлгэн өгсөн захиалга алга.</Empty>
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <thead>
                    <tr>
                      <Th>Бараа</Th>
                      <Th>Ангилал</Th>
                      <Th>Тоо</Th>
                      <Th>Анхны үнэ</Th>
                      <Th>Сүүлийн үнэ</Th>
                      <Th>Ашиг</Th>
                      <Th>Хувь</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((row) => (
                      <tr key={row.productId}>
                        <Td>{row.name}</Td>
                        <Td className="text-[13px] text-ink-2">{row.category ?? "—"}</Td>
                        <Td className="tnum">{num(row.qty)}</Td>
                        <Td className="tnum">{money(row.costPrice)}</Td>
                        <Td className="tnum">{money(row.sellPrice)}</Td>
                        <Td className="tnum">{money(row.profit)}</Td>
                        <Td>
                          <Badge tone={row.marginPercent >= 40 ? "ok" : "neutral"}>
                            {row.marginPercent}%
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>

              <div className="flex flex-col gap-3 md:hidden">
                {products.map((row) => (
                  <Card key={row.productId} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[14px] leading-[1.4]">{row.name}</div>
                        <div className="text-[13px] text-muted">{row.category ?? "—"}</div>
                      </div>
                      <Badge tone={row.marginPercent >= 40 ? "ok" : "neutral"}>
                        {row.marginPercent}%
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[13px]">
                      <div>
                        <div className="text-muted">Анхны</div>
                        <div className="tnum">{money(row.costPrice)}</div>
                      </div>
                      <div>
                        <div className="text-muted">Сүүлийн</div>
                        <div className="tnum">{money(row.sellPrice)}</div>
                      </div>
                      <div>
                        <div className="text-muted">Ашиг</div>
                        <div className="tnum">{money(row.profit)}</div>
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
