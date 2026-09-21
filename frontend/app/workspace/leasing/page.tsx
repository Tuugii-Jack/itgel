"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useOnKeyChange } from "@/lib/syncKey";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LeasingBadge,
  LeasingGoodsBadge,
  LeasingPayBadge,
  Metric,
  PageHead,
  Table,
  Td,
  Th,
} from "@/components/admin/shared";
import { Button, Card, Empty, ErrorNote, Input, Skeleton } from "@/components/ui";
import { OrderDetail } from "@/components/admin/OrderDetail";
import { LeasingScheduleSms } from "@/components/admin/LeasingScheduleSms";
import { leasingApi, ApiError } from "@/lib/api";
import { canWriteLeasingMoney } from "@/lib/admin-role";
import { useAdminSession } from "@/lib/admin-session";
import { customerNameLabel, dayLabel, money, phoneLabel } from "@/lib/format";
import { leasingArrivalUnpaid } from "@/lib/leasing";
import { useDeferredReload } from "@/lib/useDeferredReload";
import type { AdminOrderRow } from "@/lib/types";

const PAGE_SIZE = 100;

type GoodsFilter =
  | "arrived_unpaid"
  | "arrived"
  | "not_arrived"
  | "all"
  | "pay_due_today"
  | "pay_overdue"
  | "resale";

type SmsKind = "due_today" | "overdue" | "arrived_unpaid";

function smsKindOf(goods: GoodsFilter): SmsKind | null {
  if (goods === "pay_due_today") return "due_today";
  if (goods === "pay_overdue") return "overdue";
  if (goods === "arrived_unpaid") return "arrived_unpaid";
  return null;
}

export default function LeasingOrdersPage() {
  const { user } = useAdminSession();
  const canWrite = canWriteLeasingMoney(user?.role);
  const [summary, setSummary] = useState<{
    total: number;
    notArrived: number;
    arrivedUnpaid: number;
    arrivedPaid: number;
    payDueToday: number;
    payOverdue: number;
    resaleCount: number;
  } | null>(null);
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [pageMeta, setPageMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [goods, setGoods] = useState<GoodsFilter>("arrived_unpaid");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadGen = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchOrders = useCallback(
    async (page: number) => {
      const sms = smsKindOf(goods) !== null;
      const first = await leasingApi.orders({
        goods,
        q: query || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      if (!sms || page !== 1) return first;
      const pages = first.meta?.pages ?? 1;
      const data = [...first.data];
      for (let p = 2; p <= pages; p++) {
        const next = await leasingApi.orders({
          goods,
          q: query || undefined,
          page: p,
          pageSize: PAGE_SIZE,
        });
        data.push(...next.data);
      }
      return {
        data,
        meta: {
          page: 1,
          pages: 1,
          pageSize: data.length,
          total: first.meta?.total ?? data.length,
        },
      };
    },
    [goods, query],
  );

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    setError(null);
    try {
      const [s, list] = await Promise.all([leasingApi.summary(), fetchOrders(1)]);
      if (gen !== loadGen.current) return;
      setSummary(s);
      setOrders(list.data);
      setPageMeta({
        page: list.meta?.page ?? 1,
        pages: list.meta?.pages ?? 1,
        total: list.meta?.total ?? list.data.length,
      });
    } catch (e) {
      if (gen !== loadGen.current) return;
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [fetchOrders]);

  const markChanged = useDeferredReload(load, !openId);

  useOnKeyChange(`${goods}|${query}`, () => {
    setOrders([]);
    setPageMeta({ page: 1, pages: 1, total: 0 });
  });

  useEffect(() => deferEffect(() => { void load(); }), [load]);

  const selectGoods = (next: GoodsFilter) => {
    if (next === goods) return;
    loadGen.current += 1;
    setGoods(next);
    setOrders([]);
    setPageMeta({ page: 1, pages: 1, total: 0 });
    setLoading(true);
    setError(null);
  };

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

  if (openId) {
    return (
      <OrderDetail
        orderId={openId}
        api={leasingApi}
        canWrite={canWrite}
        workspace="leasing"
        onClose={() => setOpenId(null)}
        onChanged={markChanged}
      />
    );
  }

  const emptyText =
    goods === "arrived_unpaid"
      ? "Ирсэн ч төлбөр дутуу захиалга алга."
      : goods === "arrived"
        ? "Ирсэн бараатай захиалга алга."
        : goods === "not_arrived"
          ? "Ирээгүй захиалга алга."
          : goods === "pay_due_today"
            ? "Өнөөдөр төлөгдөх хуваарь алга."
            : goods === "pay_overdue"
              ? "Хоцорсон хуваарь алга."
              : goods === "resale"
                ? "Бэлэн борлуулалт алга."
                : "Лизинг захиалга олдсонгүй.";

  const smsKind = smsKindOf(goods);

  return (
    <div>
      <PageHead
        title="Лизинг захиалга"
        hint="Өнөөдөр төлөгдөөгүй, хоцорсон, ирсэн·төлөөгүй хэсэгт дугаарын жагсаалт гарна. Илгээх товч дарахад л SMS явна."
      />

      {summary && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <button type="button" className="text-left" onClick={() => selectGoods("pay_due_today")}>
            <div className={goods === "pay_due_today" ? "rounded-[12px] ring-2 ring-ink" : ""}>
              <Metric
                label="Өнөөдөр төлөгдөөгүй"
                value={String(summary.payDueToday ?? 0)}
                tone="warn"
              />
            </div>
          </button>
          <button type="button" className="text-left" onClick={() => selectGoods("pay_overdue")}>
            <div className={goods === "pay_overdue" ? "rounded-[12px] ring-2 ring-ink" : ""}>
              <Metric
                label="Хуваарь хоцорсон"
                value={String(summary.payOverdue ?? 0)}
                tone="danger"
              />
            </div>
          </button>
          <button type="button" className="text-left" onClick={() => selectGoods("arrived_unpaid")}>
            <div className={goods === "arrived_unpaid" ? "rounded-[12px] ring-2 ring-ink" : ""}>
              <Metric
                label="Ирсэн · төлөөгүй"
                value={String(summary.arrivedUnpaid)}
                tone="danger"
              />
            </div>
          </button>
          <button type="button" className="text-left" onClick={() => selectGoods("arrived")}>
            <div className={goods === "arrived" ? "rounded-[12px] ring-2 ring-ink" : ""}>
              <Metric
                label="Ирсэн"
                value={String(summary.arrivedUnpaid + summary.arrivedPaid)}
                tone="ok"
              />
            </div>
          </button>
          <button type="button" className="text-left" onClick={() => selectGoods("not_arrived")}>
            <div className={goods === "not_arrived" ? "rounded-[12px] ring-2 ring-ink" : ""}>
              <Metric label="Ирээгүй" value={String(summary.notArrived)} />
            </div>
          </button>
          <button type="button" className="text-left" onClick={() => selectGoods("all")}>
            <div className={goods === "all" ? "rounded-[12px] ring-2 ring-ink" : ""}>
              <Metric label="Нийт" value={String(summary.total)} />
            </div>
          </button>
          <button type="button" className="text-left" onClick={() => selectGoods("resale")}>
            <div className={goods === "resale" ? "rounded-[12px] ring-2 ring-ink" : ""}>
              <Metric label="Бэлэн борлуулалт" value={String(summary.resaleCount ?? 0)} />
            </div>
          </button>
        </div>
      )}

      <div className="mb-4">
        <Input value={search} onChange={setSearch} placeholder="Код, нэр, утас" className="w-52" />
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {smsKind ? (
        <LeasingScheduleSms
          key={`${goods}:${query}`}
          kind={smsKind}
          orders={loading ? [] : orders}
          loading={loading}
          emptyText={emptyText}
          onOpenOrder={setOpenId}
        />
      ) : loading && orders.length === 0 ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-[12px]" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <Empty>{emptyText}</Empty>
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Код</Th>
                  <Th>Хэрэглэгч</Th>
                  <Th>Шимтгэл</Th>
                  <Th>Үндсэн</Th>
                  <Th>Үлдэгдэл</Th>
                  <Th>Бараа</Th>
                  <Th>Огноо</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const unpaidArrived = leasingArrivalUnpaid(order.status, order.dueAmount);
                  const overdue = Boolean(order.payPlan?.overdue);
                  const dueToday = Boolean(order.payPlan?.dueToday);
                  return (
                    <tr
                      key={order.id}
                      className={
                        overdue
                          ? "bg-danger-bg"
                          : dueToday
                            ? "bg-warn-bg"
                            : unpaidArrived
                              ? "bg-danger-bg"
                              : undefined
                      }
                    >
                      <Td className="whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setOpenId(order.id)}
                          className="tnum cursor-pointer border-0 bg-transparent p-0 text-ink underline"
                        >
                          {order.code}
                        </button>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {order.isResale ? (
                            <span className="text-[12px] text-ink-2">Бэлэн борлуулалт</span>
                          ) : (
                            <>
                              <LeasingBadge />
                              <LeasingPayBadge overdue={overdue} dueToday={dueToday} />
                            </>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <div>{customerNameLabel(order.customer.name)}</div>
                        <div className="tnum text-[13px] text-muted">
                          {phoneLabel(order.customer.phone)}
                        </div>
                      </Td>
                      <Td className="tnum whitespace-nowrap">
                        {money(order.leasingFee ?? 0)}
                        <div className="text-[12px] text-muted">
                          {order.leasingFeePaid ? "төлсөн" : "төлөөгүй"}
                        </div>
                      </Td>
                      <Td className="tnum whitespace-nowrap">
                        {money(order.leasingPrincipalPaid ?? 0)} / {money(order.subtotal)}
                      </Td>
                      <Td className="tnum whitespace-nowrap">
                        {order.dueAmount > 0 ? (
                          <span className={unpaidArrived ? "text-danger" : "text-warn"}>
                            {money(order.dueAmount)}
                          </span>
                        ) : (
                          money(0)
                        )}
                      </Td>
                      <Td>
                        <LeasingGoodsBadge status={order.status} dueAmount={order.dueAmount} />
                      </Td>
                      <Td className="tnum whitespace-nowrap text-[13px] text-ink-2">
                        {dayLabel(order.createdAt)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 md:hidden">
            {orders.map((order) => {
              const unpaidArrived = leasingArrivalUnpaid(order.status, order.dueAmount);
              const overdue = Boolean(order.payPlan?.overdue);
              const dueToday = Boolean(order.payPlan?.dueToday);
              return (
                <Card
                  key={order.id}
                  className={`p-4 ${
                    overdue
                      ? "border-danger bg-danger-bg"
                      : dueToday
                        ? "border-warn bg-warn-bg"
                        : unpaidArrived
                          ? "border-danger bg-danger-bg"
                          : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setOpenId(order.id)}
                      className="tnum cursor-pointer border-0 bg-transparent p-0 text-[15px] font-medium text-ink underline"
                    >
                      {order.code}
                    </button>
                    <LeasingGoodsBadge status={order.status} dueAmount={order.dueAmount} />
                  </div>
                  <div className="mt-2 text-[14px]">{customerNameLabel(order.customer.name)}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {order.isResale ? (
                      <span className="text-[12px] text-ink-2">Бэлэн борлуулалт</span>
                    ) : (
                      <>
                        <LeasingBadge />
                        <LeasingPayBadge overdue={overdue} dueToday={dueToday} />
                      </>
                    )}
                  </div>
                  <div
                    className={`mt-2 tnum text-[13px] ${unpaidArrived ? "text-danger" : "text-ink-2"}`}
                  >
                    Шимтгэл {money(order.leasingFee ?? 0)} · үлдэгдэл{" "}
                    {money(Math.max(0, order.dueAmount))}
                  </div>
                </Card>
              );
            })}
          </div>

          {pageMeta.page < pageMeta.pages && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={() => void loadMore()} loading={moreLoading}>
                Цааш үзэх
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
