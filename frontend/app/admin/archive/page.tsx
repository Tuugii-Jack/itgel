"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Metric, OrderBadge, PageHead, ProductStatusBadge, Select } from "@/components/admin/shared";
import { ArchiveOrderList } from "@/components/admin/ArchiveOrderList";
import { ProductImage } from "@/components/ProductImage";
import { Badge, Button, Card, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayLabel, money, phoneLabel } from "@/lib/format";
import { formatPlaceLine } from "@/lib/locations";
import { formatSelections } from "@/lib/options";
import type {
  ArchiveCalendar,
  ArchiveCustomer,
  ArchiveDay,
  ArchiveProduct,
  ArchiveSearch,
} from "@/lib/types";

type Tab = "day" | "product" | "customer";

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "day", label: "Өдрөөр", hint: "Тэр өдөр хэн юу захиалсан" },
  { key: "product", label: "Бараагаар", hint: "Нэг барааны бүх түүх" },
  { key: "customer", label: "Хэрэглэгчээр", hint: "Нэг хүний бүх захиалга" },
];

const MONTHS = [
  "1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар",
  "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар",
];

/**
 * Архив — ажлын дэлгэцүүдээс тусдаа, юу ч алдагдахгүй түүх.
 *
 * Ажлын жагсаалтууд устгасныг нуудаг бол энд эсрэгээр: устгасан бараа,
 * гаргалт, захиалга ч харагдана — зөвхөн тэмдэглэгдэнэ. Архивын утга нь
 * "тэр үед юу болсон бэ" гэдгийг хэзээ ч алдахгүй байх явдал.
 */
export default function ArchivePage() {
  const [tab, setTab] = useState<Tab>("day");

  return (
    <div>
      <PageHead
        title="Архив"
        hint="Устгасан бараа, цуцлагдсан захиалга ч энд бүрэн хадгалагдана."
      />

      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`h-10 shrink-0 cursor-pointer whitespace-nowrap rounded-[8px] border px-4 text-[14px]
              ${tab === t.key ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"}`}
          >
            {t.label}
          </button>
        ))}
        <span className="hidden self-center pl-1 text-[13px] text-muted sm:inline">
          {TABS.find((t) => t.key === tab)?.hint}
        </span>
      </div>

      {tab === "day" && <ByDay />}
      {tab === "product" && <ByProduct />}
      {tab === "customer" && <ByCustomer />}
    </div>
  );
}

// ------------------------------ Өдрөөр ------------------------------

function ByDay() {
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [calendar, setCalendar] = useState<ArchiveCalendar | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [day, setDay] = useState<ArchiveDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    adminApi
      .archiveCalendar(year, month)
      .then((c) => {
        if (!alive) return;
        setCalendar(c);
        setDate(null);
        setDay(null);
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [year, month]);

  const openDay = useCallback(async (d: string) => {
    setDate(d);
    setDay(null);
    setError(null);
    try {
      setDay(await adminApi.archiveDay(d));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    }
  }, []);

  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = today.getFullYear() + 1; y >= today.getFullYear() - 4; y--) list.push(y);
    return list;
  }, [today]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
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
      ) : !calendar || calendar.days.length === 0 ? (
        <Empty>Энэ сард захиалга байхгүй.</Empty>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {calendar.days.map((d) => (
              <button
                key={d.date}
                type="button"
                onClick={() => openDay(d.date)}
                className={`cursor-pointer rounded-[12px] border p-3 text-left
                  ${date === d.date ? "border-ink bg-surface" : "border-line bg-bg hover:bg-surface"}`}
              >
                <div className="text-[14px]">{dayLabel(`${d.date}T00:00:00+08:00`)}</div>
                <div className="tnum mt-1 text-[18px] font-medium">{d.orders} захиалга</div>
                <div className="tnum text-[13px] text-muted">{money(d.revenue)}</div>
              </button>
            ))}
          </div>

          {date && !day && (
            <div className="flex justify-center py-10">
              <Spinner className="text-muted" />
            </div>
          )}

          {day && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Metric label="Захиалга" value={day.summary.orderCount} />
                <Metric label="Хэрэглэгч" value={day.summary.customerCount} tone="info" />
                <Metric label="Нийт ширхэг" value={day.summary.qty} />
                <Metric label="Дүн" value={money(day.summary.revenue)} />
              </div>
              <ArchiveOrderList orders={day.orders} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ----------------------------- Бараагаар -----------------------------

function ByProduct() {
  const { results, search, setSearch, loading } = useArchiveSearch();
  const [detail, setDetail] = useState<ArchiveProduct | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async (id: string) => {
    setBusy(true);
    try {
      setDetail(await adminApi.archiveProduct(id));
    } finally {
      setBusy(false);
    }
  };

  if (detail) {
    const { product, rounds, summary, buyers } = detail;
    return (
      <div>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-[8px] border border-line">
              <ProductImage src={product.images[0]} alt={product.name} className="h-full w-full" />
            </div>
            <div>
              <div className="text-[20px] font-medium leading-tight">{product.name}</div>
              <div className="text-[13px] text-muted">
                {product.category ?? "—"} · {summary.roundCount} гаргалт
                {product.deleted && " · устгасан бараа"}
              </div>
            </div>
          </div>
          <Button variant="ghost" onClick={() => setDetail(null)}>
            Буцах
          </Button>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Metric label="Хэдэн хүн авсан" value={summary.customerCount} />
          <Metric label="Нийт ширхэг" value={summary.qty} tone="info" />
          <Metric label="Нийт дүн" value={money(summary.revenue)} />
        </div>

        <div className="mb-2 text-[15px] font-medium">Гаргалтууд</div>
        <Card className="mb-5 divide-y divide-line">
          {rounds.map((r) => {
            const roundBuyers = buyers.filter(
              (b) => b.roundNo === r.roundNo && !b.cancelled && !b.orderDeleted,
            );
            const variantMap = new Map<string, { label: string; qty: number }>();
            for (const b of roundBuyers) {
              const label =
                formatSelections(b.selections, b.size, b.color) || "Сонголтгүй";
              const entry = variantMap.get(label) ?? { label, qty: 0 };
              entry.qty += b.qty;
              variantMap.set(label, entry);
            }
            const variants = [...variantMap.values()].sort((a, b) => b.qty - a.qty);

            return (
              <div key={r.id} className="flex flex-col gap-2 p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tnum text-[15px]">#{r.roundNo}</span>
                    <ProductStatusBadge status={r.status} />
                    <span className="text-[13px] text-muted">
                      {r.closeAt ? `${dayLabel(r.closeAt)}-нд хаагдсан` : "Бэлэн бараа"}
                    </span>
                    {r.deleted && (
                      <Badge tone="neutral">Устгасан</Badge>
                    )}
                  </div>
                  <div className="tnum flex gap-4 text-[13px]">
                    <span>{money(r.sellPrice)}</span>
                    <span className="text-ink-2">{r.customerCount} хүн</span>
                    <span className="text-ink-2">{r.qty} ш</span>
                    <span>{money(r.revenue)}</span>
                  </div>
                </div>
                {variants.length > 0 && (
                  <div className="flex flex-wrap gap-2 text-[13px] text-ink-2">
                    {variants.map((v) => (
                      <span
                        key={v.label}
                        className="rounded-[6px] border border-line bg-surface px-2 py-1"
                      >
                        {v.label}
                        <span className="tnum ml-1.5 text-muted">{v.qty} ш</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </Card>

        <div className="mb-2 text-[15px] font-medium">
          Хэн авсан
          <span className="ml-2 text-[13px] text-muted">{buyers.length} бичилт</span>
        </div>
        {buyers.length === 0 ? (
          <Empty>Захиалга байхгүй.</Empty>
        ) : (
          <Card className="divide-y divide-line">
            {buyers.map((b) => (
              <div
                key={b.id}
                className={`flex flex-wrap items-baseline justify-between gap-3 p-3.5 ${
                  b.cancelled || b.orderDeleted ? "opacity-50" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="text-[14px]">
                    {b.customer.name ?? "Нэргүй"}
                    <span className="tnum ml-2 text-[13px] text-muted">
                      {phoneLabel(b.customer.phone)}
                    </span>
                  </div>
                  <div className="tnum text-[13px] text-muted">
                    {b.code} · {dayLabel(b.createdAt)}
                    {b.roundNo !== null && ` · #${b.roundNo} гаргалт`}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[13px]">
                  <span className="text-ink-2">
                    {formatSelections(b.selections, b.size, b.color) || "—"}
                  </span>
                  <span className="tnum">{b.qty} ш</span>
                  <span className="tnum">{money(b.total)}</span>
                  {b.cancelled ? (
                    <Badge tone="danger">Цуцлагдсан</Badge>
                  ) : (
                    <OrderBadge status={b.status} />
                  )}
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <Input value={search} onChange={setSearch} placeholder="Барааны нэрээр хайх" />
      </div>
      {loading || busy ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-muted" />
        </div>
      ) : !results ? (
        <Empty>Барааны нэрээ бичнэ үү.</Empty>
      ) : results.products.length === 0 ? (
        <Empty>Бараа олдсонгүй.</Empty>
      ) : (
        <Card className="divide-y divide-line">
          {results.products.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => open(p.id)}
              className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent p-3.5 text-left hover:bg-surface"
            >
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-[6px] border border-line">
                <ProductImage src={p.image} alt={p.name} className="h-full w-full" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px]">{p.name}</div>
                <div className="text-[13px] text-muted">{p.roundCount} гаргалт</div>
              </div>
              {p.deleted && <Badge tone="neutral">Устгасан</Badge>}
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}

// --------------------------- Хэрэглэгчээр ---------------------------

function ByCustomer() {
  const { results, search, setSearch, loading } = useArchiveSearch();
  const [detail, setDetail] = useState<ArchiveCustomer | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async (id: string) => {
    setBusy(true);
    try {
      setDetail(await adminApi.archiveCustomer(id));
    } finally {
      setBusy(false);
    }
  };

  if (detail) {
    const { customer, summary, topProducts, orders } = detail;
    return (
      <div>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[20px] font-medium leading-tight">
              {customer.name ?? "Нэргүй"}
            </div>
            <div className="tnum text-[13px] text-muted">
              {phoneLabel(customer.phone)}
              {(customer.district || customer.khoroo) &&
                ` · ${formatPlaceLine(customer.district, customer.khoroo)}`}
            </div>
          </div>
          <Button variant="ghost" onClick={() => setDetail(null)}>
            Буцах
          </Button>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Захиалга" value={summary.orderCount} />
          <Metric label="Нийт ширхэг" value={summary.qty} tone="info" />
          <Metric label="Нийт төлсөн" value={money(summary.spent)} />
          <Metric
            label="Үлдэгдэл"
            value={money(summary.dueTotal)}
            tone={summary.dueTotal > 0 ? "warn" : "ok"}
          />
        </div>

        {topProducts.length > 0 && (
          <>
            <div className="mb-2 text-[15px] font-medium">Хамгийн их авдаг бараа</div>
            <Card className="mb-5 divide-y divide-line">
              {topProducts.map((p) => (
                <div
                  key={p.productId}
                  className="flex items-baseline justify-between gap-3 p-3.5 text-[14px]"
                >
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className="tnum shrink-0 text-ink-2">
                    {p.qty} ш · {money(p.total)}
                  </span>
                </div>
              ))}
            </Card>
          </>
        )}

        <div className="mb-2 text-[15px] font-medium">Бүх захиалга</div>
        <ArchiveOrderList orders={orders} hideCustomer />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <Input value={search} onChange={setSearch} placeholder="Нэр эсвэл утасны дугаараар хайх" />
      </div>
      {loading || busy ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-muted" />
        </div>
      ) : !results ? (
        <Empty>Нэр эсвэл утсаа бичнэ үү.</Empty>
      ) : results.customers.length === 0 ? (
        <Empty>Хэрэглэгч олдсонгүй.</Empty>
      ) : (
        <Card className="divide-y divide-line">
          {results.customers.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => open(c.id)}
              className="flex w-full cursor-pointer items-center justify-between gap-3 border-0 bg-transparent p-3.5 text-left hover:bg-surface"
            >
              <div>
                <div className="text-[15px]">{c.name ?? "Нэргүй"}</div>
                <div className="tnum text-[13px] text-muted">{phoneLabel(c.phone)}</div>
              </div>
              <span className="tnum shrink-0 text-[13px] text-ink-2">
                {c.orderCount} захиалга
              </span>
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}

/** Бараа ба хэрэглэгчийн хайлт — хоёр таб ижил endpoint ашиглана. */
function useArchiveSearch() {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ArchiveSearch | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = search.trim();
    if (q.length === 0) {
      setResults(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      adminApi
        .archiveSearch(q)
        .then((r) => alive && setResults(r))
        .catch(() => alive && setResults(null))
        .finally(() => alive && setLoading(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [search]);

  return { results, search, setSearch, loading };
}
