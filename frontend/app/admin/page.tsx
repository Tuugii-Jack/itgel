"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BATCH_STAGE_LABEL,
  Metric,
  OrderBadge,
  ORDER_STATUS_LABEL,
  PageHead,
  Select,
  Table,
  Td,
  Th,
} from "@/components/admin/shared";
import { Badge, Button, Card, Empty, ErrorNote, Input, Skeleton } from "@/components/ui";
import { OrderDetail } from "@/components/admin/OrderDetail";
import { adminApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { dayLabel, money, phoneLabel } from "@/lib/format";
import { PAYMENT_LABEL_SHORT, PAYMENT_TONE } from "@/lib/payment";
import type { AdminBatch, AdminOrderRow, AdminSummary, OrderStatus } from "@/lib/types";

const STATUSES: OrderStatus[] = [
  "NEW",
  "CONFIRMED",
  "IN_BATCH",
  "IN_TRANSIT",
  "ARRIVED",
  "HANDED_OVER",
  "CANCELLED",
];

const ORDERS_PAGE_SIZE = 100;

export default function AdminOrdersPage() {
  const toast = useToast();
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [pageMeta, setPageMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [batches, setBatches] = useState<AdminBatch[]>([]);
  const [status, setStatus] = useState("");
  const [batch, setBatch] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Аль үйлдэл явж байгааг заана — тухайн товч л spinner-тэй харагдана. */
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = busyAction !== null;

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchOrders = useCallback(
    (page: number) =>
      adminApi.orders({
        status: status || undefined,
        batch: batch || undefined,
        q: query || undefined,
        page,
        pageSize: ORDERS_PAGE_SIZE,
      }),
    [status, batch, query],
  );

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const [s, list, b] = await Promise.all([
        adminApi.summary(),
        fetchOrders(1),
        adminApi.batches({ pageSize: 100 }),
      ]);
      setSummary(s);
      setOrders(list.data);
      setPageMeta({
        page: list.meta?.page ?? 1,
        pages: list.meta?.pages ?? 1,
        total: list.meta?.total ?? list.data.length,
      });
      setBatches(b.data);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchOrders]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    setMoreLoading(true);
    try {
      const list = await fetchOrders(pageMeta.page + 1);
      setOrders((prev) => [...prev, ...list.data]);
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

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Сонгосон захиалгуудыг нэг хүсэлтээр шилжүүлнэ. */
  const advanceSelected = async (target: OrderStatus) => {
    setBusyAction(target);
    setError(null);

    let message: string | null = null;
    try {
      const result = await adminApi.bulkOrderStatus([...selected], target);
      if (result.failed.length > 0) {
        message =
          `${result.succeeded} амжилттай, ${result.failed.length} алдаатай — ` +
          result.failed.map((f) => `${f.code ?? f.id}: ${f.message}`).join(" · ");
        toast.error(message);
      } else {
        toast.success(
          `${result.succeeded} захиалга ${ORDER_STATUS_LABEL[target].toLowerCase()} боллоо.`,
        );
      }
    } catch (e) {
      message = e instanceof ApiError ? e.message : "Гүйцэтгэж чадсангүй.";
      toast.error(message);
    } finally {
      setBusyAction(null);
    }

    // `load()` нь алдааг цэвэрлэдэг тул мэдэгдлийг түүний дараа тавина.
    await load();
    if (message) setError(message);
  };

  const addToBatch = async (batchId: string) => {
    setBusyAction("batch");
    const count = selected.size;
    try {
      await adminApi.updateBatchOrders(batchId, { add: [...selected] });
      toast.success(`${count} захиалга багцад нэмэгдлээ.`);
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Багцад нэмж чадсангүй.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyAction(null);
    }
  };

  if (openId) {
    return (
      <OrderDetail
        orderId={openId}
        onClose={() => setOpenId(null)}
        onChanged={load}
      />
    );
  }

  const todayHandover = orders.filter(
    (o) => o.status === "ARRIVED" && o.fulfilment !== null,
  ).length;

  return (
    <div>
      <PageHead title="Захиалга" hint="Бүх захиалгын урсгал, төлөв" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Шинэ захиалга" value={summary?.newOrders ?? "—"} />
        <Metric
          label="Төлбөр шалгах"
          value={summary?.paymentClaims ?? "—"}
          tone={summary && summary.paymentClaims > 0 ? "warn" : "neutral"}
          sub="Шилжүүлсэн гэж мэдэгдсэн"
        />
        <Metric label="Ирсэн" value={summary?.arrived ?? "—"} tone="ok" />
        <Metric
          label="Өнөөдөр хүлээлгэж өгөх"
          value={todayHandover}
          sub="Авах аргаа сонгосон"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onChange={setStatus}
          placeholder="Бүх статус"
          options={STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABEL[s] }))}
        />
        <Select
          value={batch}
          onChange={setBatch}
          placeholder="Бүх багц"
          options={batches.map((b) => ({ value: b.id, label: b.name }))}
        />
        <div className="min-w-[200px] flex-1">
          <Input
            value={search}
            onChange={setSearch}
            placeholder="Код, нэр, утасны сүүлийн 4 орон"
          />
        </div>
        {refreshing && (
          <span className="text-[13px] text-muted">Шинэчилж байна…</span>
        )}
      </div>

      {selected.size > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
          <span className="text-[14px]">{selected.size} захиалга сонгосон</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => advanceSelected("CONFIRMED")}
              disabled={busy}
              loading={busyAction === "CONFIRMED"}
            >
              Баталгаажуулах
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => advanceSelected("CANCELLED")}
              disabled={busy}
              loading={busyAction === "CANCELLED"}
            >
              Цуцлах
            </Button>
            <Select
              value=""
              onChange={(id) => id && addToBatch(id)}
              placeholder="Багцад нэмэх"
              className="h-9 text-[13px]"
              options={batches
                .filter((b) => b.stage === "COLLECTING" || b.stage === "CLOSED")
                .map((b) => ({ value: b.id, label: b.name }))}
            />
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Болих
            </Button>
          </div>
        </Card>
      )}

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading && orders.length === 0 ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-[12px]" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <Empty>Захиалга олдсонгүй.</Empty>
      ) : (
        <>
          {/* Desktop — хүснэгт */}
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Бүгдийг сонгох"
                      checked={selected.size === orders.length && orders.length > 0}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(orders.map((o) => o.id)) : new Set())
                      }
                    />
                  </Th>
                  <Th>Код</Th>
                  <Th>Хэрэглэгч</Th>
                  <Th>Бараа</Th>
                  <Th>Дүн</Th>
                  <Th>Төлбөр</Th>
                  <Th>Статус</Th>
                  <Th>Багц</Th>
                  <Th>Огноо</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className={selected.has(order.id) ? "bg-surface" : ""}>
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`${order.code} сонгох`}
                        checked={selected.has(order.id)}
                        onChange={() => toggle(order.id)}
                      />
                    </Td>
                    <Td className="whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setOpenId(order.id)}
                        className="tnum cursor-pointer border-0 bg-transparent p-0 text-ink underline"
                      >
                        {order.code}
                      </button>
                    </Td>
                    <Td>
                      <div>{order.customer.name ?? "—"}</div>
                      <div className="tnum text-[13px] text-muted">
                        {phoneLabel(order.customer.phone)}
                      </div>
                    </Td>
                    <Td className="tnum">{order.itemCount} ш</Td>
                    <Td className="tnum whitespace-nowrap">
                      <div>{money(order.subtotal)}</div>
                      {order.dueAmount > 0 && (
                        <div className="text-[13px] text-warn">
                          үлдэгдэл {money(order.dueAmount)}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={PAYMENT_TONE[order.paymentState]}>
                        {PAYMENT_LABEL_SHORT[order.paymentState]}
                      </Badge>
                      {order.paymentClaimedAt && order.dueAmount > 0 && (
                        <div className="mt-1 text-[12px] text-info">Шилжүүлсэн гэсэн</div>
                      )}
                    </Td>
                    <Td>
                      <OrderBadge status={order.status} />
                    </Td>
                    <Td className="text-[13px] text-ink-2">
                      {order.batch ? (
                        <>
                          <div>{order.batch.name}</div>
                          <div className="text-muted">{BATCH_STAGE_LABEL[order.batch.stage]}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="tnum whitespace-nowrap text-[13px] text-ink-2">
                      {dayLabel(order.createdAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          {/* Утас — карт */}
          <div className="flex flex-col gap-3 md:hidden">
            {orders.map((order) => (
              <Card key={order.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`${order.code} сонгох`}
                      checked={selected.has(order.id)}
                      onChange={() => toggle(order.id)}
                    />
                    <button
                      type="button"
                      onClick={() => setOpenId(order.id)}
                      className="tnum cursor-pointer border-0 bg-transparent p-0 text-[15px] font-medium text-ink underline"
                    >
                      {order.code}
                    </button>
                  </label>
                  <OrderBadge status={order.status} />
                </div>
                <div className="mt-2 text-[14px]">{order.customer.name ?? "Нэргүй"}</div>
                <div className="tnum text-[13px] text-muted">
                  {phoneLabel(order.customer.phone)} · {order.itemCount} бараа
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="tnum text-[15px]">{money(order.subtotal)}</span>
                  <span className="tnum text-[13px] text-muted">{dayLabel(order.createdAt)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge tone={PAYMENT_TONE[order.paymentState]}>
                    {PAYMENT_LABEL_SHORT[order.paymentState]}
                  </Badge>
                  {order.paymentClaimedAt && order.dueAmount > 0 && (
                    <Badge tone="info">Шилжүүлсэн гэсэн</Badge>
                  )}
                  {order.batch && <Badge tone="info">{order.batch.name}</Badge>}
                </div>
                </Card>
            ))}
          </div>

          {pageMeta.page < pageMeta.pages && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={loadMore} loading={moreLoading}>
                Цааш үзэх · {pageMeta.total - orders.length} захиалга
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
