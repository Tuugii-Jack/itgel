"use client";

import { useCallback, useEffect, useState } from "react";
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
import { leasingApi, ApiError } from "@/lib/api";
import { dayLabel, money, phoneLabel } from "@/lib/format";
import { leasingArrivalUnpaid } from "@/lib/leasing";
import type { AdminOrderRow } from "@/lib/types";

const PAGE_SIZE = 100;

type GoodsFilter =
  | "arrived_unpaid"
  | "arrived"
  | "not_arrived"
  | "all"
  | "pay_due_today"
  | "pay_overdue";

export default function LeasingOrdersPage() {
  const [summary, setSummary] = useState<{
    total: number;
    notArrived: number;
    arrivedUnpaid: number;
    arrivedPaid: number;
    payDueToday: number;
    payOverdue: number;
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

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchOrders = useCallback(
    (page: number) =>
      leasingApi.orders({
        goods,
        q: query || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [goods, query],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, list] = await Promise.all([leasingApi.summary(), fetchOrders(1)]);
      setSummary(s);
      setOrders(list.data);
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

  if (openId) {
    return (
      <OrderDetail
        orderId={openId}
        api={leasingApi}
        canWrite
        workspace="leasing"
        onClose={() => setOpenId(null)}
        onChanged={() => void load()}
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
              : "Лизинг захиалга олдсонгүй.";

  return (
    <div>
      <PageHead
        title="Лизинг захиалга"
        hint="Өнөөдрийн хуваарь болон хоцорсон төлөлтийг эндээс хар. Бараа ирсэн эсэхээр ч шүүнэ."
      />

      {summary && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <button type="button" className="text-left" onClick={() => setGoods("pay_due_today")}>
            <div className={goods === "pay_due_today" ? "rounded-[12px] ring-2 ring-ink" : ""}>
              <Metric
                label="Өнөөдөр төлөгдөөгүй"
                value={String(summary.payDueToday ?? 0)}
                tone="warn"
              />
            </div>
          </button>
          <button type="button" className="text-left" onClick={() => setGoods("pay_overdue")}>
            <div className={goods === "pay_overdue" ? "rounded-[12px] ring-2 ring-ink" : ""}>
              <Metric
                label="Хуваарь хоцорсон"
                value={String(summary.payOverdue ?? 0)}
                tone="danger"
              />
            </div>
          </button>
          <button type="button" className="text-left" onClick={() => setGoods("arrived_unpaid")}>
            <div className={goods === "arrived_unpaid" ? "rounded-[12px] ring-2 ring-ink" : ""}>
              <Metric
                label="Ирсэн · төлөөгүй"
                value={String(summary.arrivedUnpaid)}
                tone="danger"
              />
            </div>
          </button>
          <button type="button" className="text-left" onClick={() => setGoods("arrived")}>
            <div className={goods === "arrived" ? "rounded-[12px] ring-2 ring-ink" : ""}>
              <Metric
                label="Ирсэн"
                value={String(summary.arrivedUnpaid + summary.arrivedPaid)}
                tone="ok"
              />
            </div>
          </button>
          <button type="button" className="text-left" onClick={() => setGoods("not_arrived")}>
            <div className={goods === "not_arrived" ? "rounded-[12px] ring-2 ring-ink" : ""}>
              <Metric label="Ирээгүй" value={String(summary.notArrived)} />
            </div>
          </button>
          <button type="button" className="text-left" onClick={() => setGoods("all")}>
            <div className={goods === "all" ? "rounded-[12px] ring-2 ring-ink" : ""}>
              <Metric label="Нийт" value={String(summary.total)} />
            </div>
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Input value={search} onChange={setSearch} placeholder="Код, нэр, утас" className="w-52" />
      </div>

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
                          <LeasingBadge />
                          <LeasingPayBadge overdue={overdue} dueToday={dueToday} />
                        </div>
                      </Td>
                      <Td>
                        <div>{order.customer.name ?? "—"}</div>
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
                  <div className="mt-2 text-[14px]">{order.customer.name ?? "Нэргүй"}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <LeasingBadge />
                    <LeasingPayBadge overdue={overdue} dueToday={dueToday} />
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
