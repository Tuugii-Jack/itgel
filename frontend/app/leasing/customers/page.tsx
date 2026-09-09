"use client";

import { useCallback, useEffect, useState } from "react";
import { OrderDetail } from "@/components/admin/OrderDetail";
import { LeasingBadge, LeasingGoodsBadge, PageHead, Table, Td, Th } from "@/components/admin/shared";
import { Card, Empty, ErrorNote, Input, Skeleton } from "@/components/ui";
import { leasingApi, ApiError } from "@/lib/api";
import { dayLabel, money, phoneLabel } from "@/lib/format";
import { leasingArrivalUnpaid } from "@/lib/leasing";
import type { AdminCustomer, AdminOrderRow } from "@/lib/types";

type CustomerRow = AdminCustomer & {
  orderCount?: number;
  totalSpent?: number;
  dueAmount?: number;
};

type CustomerDetail = AdminCustomer & {
  stats: {
    orderCount: number;
    totalSpent: number;
    handedOver: number;
    cancelled: number;
    lastOrderAt: string | null;
  };
  orders: AdminOrderRow[];
};

export default function LeasingCustomersPage() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await leasingApi.customers({ q: query || undefined, pageSize: 100 });
      setRows(list.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    void leasingApi
      .customer(openId)
      .then(setDetail)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй."));
  }, [openId]);

  if (openOrderId) {
    return (
      <OrderDetail
        orderId={openOrderId}
        api={leasingApi}
        canWrite
        workspace="leasing"
        onClose={() => setOpenOrderId(null)}
        onChanged={() => {
          if (openId) void leasingApi.customer(openId).then(setDetail);
        }}
      />
    );
  }

  if (openId && detail) {
    return (
      <div>
        <PageHead
          title={detail.name ?? detail.email}
          hint={phoneLabel(detail.phone)}
          actions={
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="h-9 cursor-pointer rounded-[8px] border border-line bg-bg px-3 text-[13px]"
            >
              Буцах
            </button>
          }
        />
        <div className="mb-4 text-[13px] text-ink-2">
          Лизинг захиалга {detail.stats.orderCount} · {money(detail.stats.totalSpent)}
        </div>
        <div className="flex flex-col gap-2">
          {detail.orders.map((order) => {
            const unpaidArrived = leasingArrivalUnpaid(order.status, order.dueAmount);
            return (
            <Card
              key={order.id}
              className={`flex items-center justify-between gap-3 p-4 ${unpaidArrived ? "border-danger bg-danger-bg" : ""}`}
            >
              <div>
                <button
                  type="button"
                  onClick={() => setOpenOrderId(order.id)}
                  className="tnum cursor-pointer border-0 bg-transparent p-0 text-[15px] font-medium underline"
                >
                  {order.code}
                </button>
                <div className="mt-1 flex flex-wrap gap-2">
                  <LeasingBadge />
                  <LeasingGoodsBadge status={order.status} dueAmount={order.dueAmount} />
                </div>
              </div>
              <div className="tnum text-right text-[14px]">
                <div>{money(order.subtotal)}</div>
                {order.dueAmount > 0 && (
                  <div className={`text-[13px] ${unpaidArrived ? "text-danger" : "text-warn"}`}>
                    үлдэгдэл {money(order.dueAmount)}
                  </div>
                )}
              </div>
            </Card>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHead
        title="Лизинг хэрэглэгчид"
        hint="Шимтгэл төлсөн лизинг хэрэглэгчид."
      />
      <div className="mb-4">
        <Input value={search} onChange={setSearch} placeholder="Нэр, и-мэйл, утас" className="w-64" />
      </div>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-[12px]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty>Хэрэглэгч олдсонгүй.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Хэрэглэгч</Th>
              <Th>Захиалга</Th>
              <Th>Дүн</Th>
              <Th>Огноо</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <Td>
                  <button
                    type="button"
                    onClick={() => setOpenId(row.id)}
                    className="cursor-pointer border-0 bg-transparent p-0 text-left text-ink underline"
                  >
                    {row.name ?? row.email}
                  </button>
                  <div className="tnum text-[13px] text-muted">{phoneLabel(row.phone)}</div>
                </Td>
                <Td className="tnum">{row.orderCount ?? 0}</Td>
                <Td className="tnum">{money(row.totalSpent ?? 0)}</Td>
                <Td className="tnum text-[13px] text-ink-2">{dayLabel(row.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
