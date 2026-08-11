"use client";

import { useCallback, useEffect, useState } from "react";
import { OrderDetail } from "@/components/admin/OrderDetail";
import {
  Metric,
  OrderBadge,
  PageHead,
  Table,
  Td,
  Th,
} from "@/components/admin/shared";
import { Button, Empty, ErrorNote, Input, Skeleton } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayLabel, money, phoneLabel } from "@/lib/format";
import type { AdminCustomer, OrderItem } from "@/lib/types";

type CustomerOrder = {
  id: string;
  code: string;
  status: import("@/lib/types").OrderStatus;
  statusLabel: string;
  subtotal: number;
  dueAmount: number;
  fulfilment: string | null;
  items: OrderItem[];
  createdAt: string;
};

type CustomerDetail = AdminCustomer & {
  stats: {
    orderCount: number;
    totalSpent: number;
    handedOver: number;
    cancelled: number;
    lastOrderAt: string | null;
  };
  orders: CustomerOrder[];
};

export default function CustomersPage() {
  const [rows, setRows] = useState<AdminCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const list = await adminApi.customers({ q: query || undefined, pageSize: 100 });
      setRows(list.data);
      setTotal(list.meta?.total ?? list.data.length);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  // OrderDetail-аас холбоосоор ирсэн хэрэглэгчийг нээнэ.
  useEffect(() => {
    try {
      const id = sessionStorage.getItem("itgel.admin.openCustomer");
      if (id) {
        sessionStorage.removeItem("itgel.admin.openCustomer");
        setOpenId(id);
      }
    } catch {
      /* ignore */
    }
  }, []);

  if (openOrderId) {
    return (
      <OrderDetail
        orderId={openOrderId}
        onClose={() => setOpenOrderId(null)}
        onChanged={() => void load()}
      />
    );
  }

  if (openId) {
    return (
      <CustomerDetailView
        customerId={openId}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
        onOpenOrder={setOpenOrderId}
      />
    );
  }

  const spent = rows.reduce((sum, r) => sum + r.totalSpent, 0);
  const repeat = rows.filter((r) => r.orderCount > 1).length;

  return (
    <div>
      <PageHead title="Хэрэглэгчид" hint="Утасны дугаараар бүртгэгддэг. Мөр дээр дараад дэлгэрэнгүйг харна." />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Нийт хэрэглэгч" value={total} />
        <Metric label="Давтан захиалагч" value={repeat} tone="ok" />
        <Metric label="Нийт зарцуулалт" value={money(spent)} sub="Энэ хуудсанд" />
        <Metric
          label="Дундаж"
          value={money(rows.length ? Math.round(spent / rows.length) : 0)}
        />
      </div>

      <div className="mb-4 flex max-w-[420px] items-center gap-2">
        <div className="flex-1">
          <Input value={search} onChange={setSearch} placeholder="Нэр эсвэл утасны дугаар" />
        </div>
        {refreshing && <span className="text-[13px] text-muted">Шинэчилж байна…</span>}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-[12px]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty>Хэрэглэгч олдсонгүй.</Empty>
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Нэр</Th>
                  <Th>Утас</Th>
                  <Th>Захиалга</Th>
                  <Th>Нийт зарцуулалт</Th>
                  <Th>Сүүлд</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setOpenId(row.id)}
                    className="cursor-pointer transition-colors hover:bg-surface"
                  >
                    <Td>
                      <span className="underline underline-offset-2">{row.name ?? "—"}</span>
                    </Td>
                    <Td className="tnum">{phoneLabel(row.phone)}</Td>
                    <Td className="tnum">{row.orderCount}</Td>
                    <Td className="tnum">{money(row.totalSpent)}</Td>
                    <Td className="tnum text-[13px] text-ink-2">
                      {row.lastOrderAt ? dayLabel(row.lastOrderAt) : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setOpenId(row.id)}
                className="cursor-pointer rounded-[12px] border border-line bg-bg p-4 text-left"
              >
                <div className="text-[15px]">{row.name ?? "Нэргүй"}</div>
                <div className="tnum text-[13px] text-muted">{phoneLabel(row.phone)}</div>
                <div className="mt-2 flex items-baseline justify-between text-[13px]">
                  <span className="text-muted">{row.orderCount} захиалга</span>
                  <span className="tnum">{money(row.totalSpent)}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CustomerDetailView({
  customerId,
  onBack,
  onOpenOrder,
}: {
  customerId: string;
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const detail = await adminApi.customer(customerId);
        if (!cancelled) setData(detail as CustomerDetail);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  if (loading) {
    return (
      <div>
        <Skeleton className="mb-4 h-9 w-40" />
        <Skeleton className="mb-3 h-24" />
        <Skeleton className="h-[240px]" />
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <Button variant="outline" size="sm" onClick={onBack}>
          ← Буцах
        </Button>
        <div className="mt-4">
          <ErrorNote>{error ?? "Хэрэглэгч олдсонгүй."}</ErrorNote>
        </div>
      </div>
    );
  }

  const debt = data.orders
    .filter((o) => o.status !== "CANCELLED")
    .reduce((sum, o) => sum + Math.max(0, o.dueAmount), 0);

  return (
    <div>
      <div className="mb-4">
        <Button variant="outline" size="sm" onClick={onBack}>
          ← Хэрэглэгчид
        </Button>
      </div>

      <PageHead
        title={data.name ?? "Нэргүй"}
        hint={`${phoneLabel(data.phone)} · бүртгэгдсэн ${dayLabel(data.createdAt)}`}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Захиалга" value={data.stats.orderCount} />
        <Metric label="Нийт зарцуулалт" value={money(data.stats.totalSpent)} />
        <Metric label="Хүлээлгэн өгсөн" value={data.stats.handedOver} tone="ok" />
        <Metric
          label="Дутуу төлбөр"
          value={money(debt)}
          tone={debt > 0 ? "warn" : "ok"}
        />
      </div>

      <h2 className="mb-2 text-[16px] font-medium">Захиалгын түүх</h2>
      {data.orders.length === 0 ? (
        <Empty>Захиалга алга.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Код</Th>
              <Th>Огноо</Th>
              <Th className="text-right">Дүн</Th>
              <Th>Төлөв</Th>
            </tr>
          </thead>
          <tbody>
            {data.orders.map((order) => {
              const itemCount = order.items
                .filter((i) => !i.cancelled)
                .reduce((sum, i) => sum + i.qty, 0);
              return (
                <tr
                  key={order.id}
                  onClick={() => onOpenOrder(order.id)}
                  className="cursor-pointer transition-colors hover:bg-surface"
                >
                  <Td>
                    <span className="tnum underline underline-offset-2">{order.code}</span>
                    <div className="text-[12px] text-muted">{itemCount} ш</div>
                  </Td>
                  <Td className="tnum text-[13px] text-ink-2">{dayLabel(order.createdAt)}</Td>
                  <Td className="text-right">
                    <span className="tnum">{money(order.subtotal)}</span>
                    {order.dueAmount > 0 && (
                      <div className="tnum text-[12px] text-warn">
                        дутуу {money(order.dueAmount)}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <OrderBadge status={order.status} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
