"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Metric, PageHead, Select, Table, Td, Th } from "@/components/admin/shared";
import { Badge, Button, Card, Empty, ErrorNote, Skeleton } from "@/components/ui";
import { useAdminSession } from "@/lib/admin-session";
import { isFullAdmin } from "@/lib/admin-role";
import { adminApi, ApiError } from "@/lib/api";
import { dayKey, money, phoneLabel } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import {
  DEFAULT_RETURNS_PRINT,
  printReturns,
  type ReturnsPrintOptions,
} from "@/lib/printReturns";
import type { ReturnPayout, ReturnProduct, ReturnsCalendar, ReturnsList } from "@/lib/types";

const MONTHS = [
  "1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар",
  "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар",
];

const WEEKDAYS = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];

type Tab = "products" | "payouts";

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

function groupProducts(rows: ReturnProduct[]): {
  name: string;
  qty: number;
  amount: number;
  variants: ReturnProduct[];
}[] {
  const map = new Map<string, { name: string; qty: number; amount: number; variants: ReturnProduct[] }>();
  for (const row of rows) {
    const key = `${row.productId}:${row.name}`;
    const entry = map.get(key) ?? { name: row.name, qty: 0, amount: 0, variants: [] };
    entry.qty += row.qty;
    entry.amount += row.amount;
    entry.variants.push(row);
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "mn"));
}

export default function AdminReturnsPage() {
  const { user } = useAdminSession();
  const canWrite = isFullAdmin(user?.role);
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [calendar, setCalendar] = useState<ReturnsCalendar | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [data, setData] = useState<ReturnsList | null>(null);
  const [tab, setTab] = useState<Tab>("products");
  const [loadingCal, setLoadingCal] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printOpts, setPrintOpts] = useState<ReturnsPrintOptions>(DEFAULT_RETURNS_PRINT);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [ask, setAsk] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = today.getFullYear() + 1; y >= today.getFullYear() - 4; y--) list.push(y);
    return list;
  }, [today]);

  const byDate = useMemo(() => {
    const map = new Map<string, ReturnsCalendar["days"][number]>();
    for (const day of calendar?.days ?? []) map.set(day.date, day);
    return map;
  }, [calendar]);

  const cells = useMemo(() => monthCells(year, month), [year, month]);
  const todayKey = dayKey(today);
  const selectable = calendar?.days.map((d) => d.date) ?? [];

  useEffect(() => {
    let alive = true;
    setLoadingCal(true);
    setError(null);
    adminApi
      .returnsCalendar(year, month)
      .then((c) => {
        if (!alive) return;
        setCalendar(c);
        setSelected([]);
        setData(null);
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй."))
      .finally(() => alive && setLoadingCal(false));
    return () => {
      alive = false;
    };
  }, [year, month]);

  const loadList = useCallback(async (days: string[]) => {
    if (days.length === 0) {
      setData(null);
      return;
    }
    setLoadingList(true);
    setError(null);
    try {
      setData(await adminApi.returns(days));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
      setData(null);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    setChecked(new Set());
    setAsk(false);
    void loadList(selected);
  }, [selected, loadList]);

  const toggleDay = (date: string) => {
    if (!byDate.has(date)) return;
    setSelected((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date].sort(),
    );
  };

  const shiftMonth = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  };

  const missingBank = data?.payouts.filter((p) => !p.bankAccountNumber.trim()).length ?? 0;
  const grouped = useMemo(() => groupProducts(data?.products ?? []), [data]);
  const unpaidPayouts = data?.payouts.filter((p) => !p.paid) ?? [];

  const toggleChecked = (customerId: string) => {
    setAsk(false);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  };

  const toggleAllUnpaid = (on: boolean) => {
    setAsk(false);
    setChecked(on ? new Set(unpaidPayouts.map((p) => p.customerId)) : new Set());
  };

  const confirmPaid = async () => {
    const ids = [...checked].filter((id) => unpaidPayouts.some((p) => p.customerId === id));
    if (ids.length === 0 || selected.length === 0) return;
    setConfirming(true);
    setError(null);
    try {
      const next = await adminApi.confirmReturnPayouts(selected, ids);
      setData(next);
      setChecked(new Set());
      setAsk(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Баталгаажуулж чадсангүй.");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div>
      <PageHead
        title="Буцаалт"
        hint="Данс руу шилжүүлсний дараа хэрэглэгчийг тэмдэглээд Тийм дарна. Тэгвэл хэрэглэгчид «Буцаалт орсон» гэж харагдана."
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={!data || (data.products.length === 0 && data.payouts.length === 0)}
            onClick={() => setPrintOpen((v) => !v)}
          >
            Хэвлэх
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => shiftMonth(-1)}>
          Өмнөх
        </Button>
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
        <Button size="sm" variant="outline" onClick={() => shiftMonth(1)}>
          Дараах
        </Button>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loadingCal ? (
        <Skeleton className="mb-5 h-72 w-full rounded-[12px]" />
      ) : (
        <Card className="mb-5 p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[13px] text-muted">
              {selected.length > 0
                ? `${selected.length} өдөр сонгосон`
                : "10, 20, 30-г дарж сонгоно. Олон өдөр сонгож болно."}
            </div>
            {selectable.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setSelected(selected.length === selectable.length ? [] : [...selectable])
                }
                className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-ink-2 underline"
              >
                {selected.length === selectable.length ? "Арилгах" : "10, 20, 30-г сонгох"}
              </button>
            )}
          </div>
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
              const active = selected.includes(date);
              const isToday = date === todayKey;
              const payout = Boolean(stats);
              return (
                <button
                  key={date}
                  type="button"
                  disabled={!payout}
                  onClick={() => toggleDay(date)}
                  className={`min-h-[64px] rounded-[8px] border p-1.5 text-left ${
                    active
                      ? "border-ink bg-ink text-white"
                      : payout
                        ? "cursor-pointer border-line bg-bg hover:border-primary-muted"
                        : "cursor-default border-transparent bg-transparent text-muted"
                  } ${isToday && !active ? "ring-1 ring-ink/30" : ""}`}
                >
                  <div className="text-[13px] font-medium">{day}</div>
                  {payout && (
                    <div className={`mt-0.5 text-[11px] ${active ? "opacity-80" : "text-muted"}`}>
                      {stats && stats.qty > 0
                        ? `${stats.qty} ш · ${stats.customerCount} хүн`
                        : "буцаалт"}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-3 text-[13px] text-muted">
            10-оос өмнө буцаасан нь 10-нд, 20-оос өмнө нь 20-нд, 30-аас өмнө нь 30-нд орно.
          </div>
        </Card>
      )}

      {printOpen && data && (
        <Card className="mb-4 flex flex-col gap-3 p-4">
          <div className="text-[14px] font-medium">Хэвлэх сонголт</div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={printOpts.products}
                onChange={(e) => setPrintOpts((o) => ({ ...o, products: e.target.checked }))}
              />
              Бараа нэгтгэл
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={printOpts.payouts}
                onChange={(e) => setPrintOpts((o) => ({ ...o, payouts: e.target.checked }))}
              />
              Данс (дугаар давхар)
            </label>
          </div>
          <div>
            <Button
              size="sm"
              disabled={!printOpts.products && !printOpts.payouts}
              onClick={() => printReturns(data, printOpts)}
            >
              Хэвлэх
            </Button>
          </div>
        </Card>
      )}

      {selected.length === 0 ? (
        <Empty>Календараас 10, 20, 30-г сонгоод буцаалтын бараа, дансыг харна.</Empty>
      ) : loadingList ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-[12px]" />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Бараа" value={data.summary.productCount} />
            <Metric label="Ширхэг" value={data.summary.qty} />
            <Metric label="Дүн" value={money(data.summary.amount)} />
            <Metric
              label="Хэрэглэгч"
              value={data.summary.customerCount}
              sub={
                missingBank > 0
                  ? `${missingBank} дансгүй`
                  : data.summary.unpaidCustomerCount
                    ? `${data.summary.unpaidCustomerCount} шилжүүлээгүй`
                    : data.payouts.some((p) => p.paid)
                      ? "бүгд орсон"
                      : undefined
              }
              tone={missingBank > 0 || (data.summary.unpaidCustomerCount ?? 0) > 0 ? "warn" : "info"}
            />
          </div>

          <div className="mb-4 flex gap-2">
            <button
              type="button"
              onClick={() => setTab("products")}
              className={`h-10 cursor-pointer rounded-[8px] border px-4 text-[14px] ${
                tab === "products" ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"
              }`}
            >
              Бараа
            </button>
            <button
              type="button"
              onClick={() => setTab("payouts")}
              className={`h-10 cursor-pointer rounded-[8px] border px-4 text-[14px] ${
                tab === "payouts" ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"
              }`}
            >
              Данс
            </button>
          </div>

          {tab === "products" ? (
            grouped.length === 0 ? (
              <Empty>Сонгосон өдөрт буцаалтын бараа алга.</Empty>
            ) : (
              <div className="flex flex-col gap-3">
                {grouped.map((group) => (
                  <Card key={group.name} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="text-[15px] font-medium">{group.name}</div>
                      <div className="tnum text-[18px] font-medium">{group.qty} ш</div>
                    </div>
                    <div className="mt-1 text-[13px] text-ink-2">{money(group.amount)}</div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {group.variants.map((row) => {
                        const label =
                          formatSelections(row.selections, row.size, row.color) || "Сонголтгүй";
                        return (
                          <span
                            key={`${row.productId}:${label}`}
                            className="rounded-[8px] border border-line bg-surface px-2.5 py-1 text-[13px]"
                          >
                            {label} <span className="tnum font-medium">{row.qty}</span>
                          </span>
                        );
                      })}
                    </div>
                  </Card>
                ))}
              </div>
            )
          ) : data.payouts.length === 0 ? (
            <Empty>Сонгосон өдөрт хэрэглэгч алга.</Empty>
          ) : (
            <>
              <PayoutTable
                rows={data.payouts}
                canWrite={canWrite}
                checked={checked}
                onToggle={toggleChecked}
                onToggleAll={toggleAllUnpaid}
              />
              {canWrite && unpaidPayouts.length > 0 && (
                <Card className="mt-3 p-4">
                  {ask ? (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-[14px]">
                        Сонгосон {checked.size} хэрэглэгчийн данс руу мөнгө шилжүүлсэн үү?
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={confirming}
                          onClick={() => setAsk(false)}
                        >
                          Үгүй
                        </Button>
                        <Button size="sm" loading={confirming} onClick={() => void confirmPaid()}>
                          Тийм
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-[13px] text-ink-2">
                        {checked.size > 0
                          ? `${checked.size} хэрэглэгч сонгосон — шилжүүлсний дараа Тийм дарна.`
                          : "Шилжүүлсэн хэрэглэгчийг тэмдэглээд Тийм дарна. Хэрэглэгчид «Буцаалт орсон» гэж харагдана."}
                      </div>
                      <Button
                        size="sm"
                        disabled={checked.size === 0}
                        onClick={() => setAsk(true)}
                      >
                        Тийм
                      </Button>
                    </div>
                  )}
                </Card>
              )}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function PayoutTable({
  rows,
  canWrite,
  checked,
  onToggle,
  onToggleAll,
}: {
  rows: ReturnPayout[];
  canWrite: boolean;
  checked: Set<string>;
  onToggle: (customerId: string) => void;
  onToggleAll: (on: boolean) => void;
}) {
  const unpaid = rows.filter((row) => !row.paid);
  const allChecked = unpaid.length > 0 && unpaid.every((row) => checked.has(row.customerId));
  return (
    <Table>
      <thead>
        <tr>
          {canWrite && (
            <Th className="w-10">
              {unpaid.length > 0 ? (
                <input
                  type="checkbox"
                  aria-label="Бүгдийг сонгох"
                  checked={allChecked}
                  onChange={(e) => onToggleAll(e.target.checked)}
                />
              ) : null}
            </Th>
          )}
          <Th>Хэрэглэгч</Th>
          <Th>Банк</Th>
          <Th>Данс эзэмшигч</Th>
          <Th>Дансны дугаар</Th>
          <Th className="text-right">Дүн</Th>
          <Th>Төлөв</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const account = row.bankAccountNumber.trim() || "—";
          const missing = !row.bankAccountNumber.trim();
          return (
            <tr key={row.customerId} className={checked.has(row.customerId) ? "bg-surface" : ""}>
              {canWrite && (
                <Td>
                  {row.paid ? null : (
                    <input
                      type="checkbox"
                      aria-label={`${row.name ?? row.email} сонгох`}
                      checked={checked.has(row.customerId)}
                      onChange={() => onToggle(row.customerId)}
                    />
                  )}
                </Td>
              )}
              <Td>
                <div className="font-medium">{row.name?.trim() || "Нэргүй"}</div>
                <div className="text-[12px] text-muted">{phoneLabel(row.phone)}</div>
              </Td>
              <Td>{row.bankName.trim() || "—"}</Td>
              <Td>{row.bankAccountName.trim() || "—"}</Td>
              <Td className={`tnum font-medium ${missing ? "text-danger" : ""}`}>{account}</Td>
              <Td className="tnum text-right">{money(row.amount)}</Td>
              <Td>
                {row.paid ? <Badge tone="ok">Орсон</Badge> : <Badge tone="warn">Хүлээгдэж</Badge>}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
