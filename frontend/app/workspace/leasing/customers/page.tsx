"use client";

import { useWorkspaceQuery } from "@/lib/useWorkspaceQuery";
import { SearchField } from "@/components/admin/SearchField";
import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useRef, useState } from "react";
import { OrderDetail } from "@/components/admin/OrderDetail";
import { LeasingBadge, LeasingGoodsBadge, PageHead, Table, Td, Th } from "@/components/admin/shared";
import { Button, Card, Empty, ErrorNote, Skeleton } from "@/components/ui";
import { canWriteLeasingMoney } from "@/lib/admin-role";
import { leasingApi, ApiError } from "@/lib/api";
import { useAdminSession } from "@/lib/admin-session";
import { dayLabel, money, phoneLabel } from "@/lib/format";
import { leasingArrivalUnpaid } from "@/lib/leasing";
import { useDeferredReload } from "@/lib/useDeferredReload";
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
  const { user } = useAdminSession();
  const canWrite = canWriteLeasingMoney(user?.role);
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useWorkspaceQuery("q", "", true);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useWorkspaceQuery("id");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailReload, setDetailReload] = useState(0);
  const listRequest = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const request = ++listRequest.current;
    setError(null);
    try {
      const list = await leasingApi.customers({ q: query || undefined, pageSize: 100 });
      if (request !== listRequest.current) return;
      setRows(list.data);
    } catch (e) {
      if (request !== listRequest.current) return;
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [query]);

  const markChanged = useDeferredReload(load, !openId && !openOrderId);

  useEffect(() => {
    const requests = listRequest;
    const cancel = deferEffect(() => { void load(); });
    return () => { cancel(); requests.current++; };
  }, [load]);

  useEffect(() => {
    if (!openId) {
      return deferEffect(() => {
        setDetail(null);
      });
    }
    if (openOrderId) return;
    let active = true;
    const cancel = deferEffect(() => {
      setDetail(null); setDetailError(null);
      void leasingApi
        .customer(openId)
        .then((data) => { if (active) setDetail(data); })
        .catch((e) => { if (active) setDetailError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй."); });
    });
    return () => { active = false; cancel(); };
  }, [openId, openOrderId, detailReload]);

  if (openOrderId) {
    return (
      <OrderDetail
        orderId={openOrderId}
        api={leasingApi}
        canWrite={canWrite}
        workspace="leasing"
        onClose={() => setOpenOrderId(null)}
        onChanged={markChanged}
      />
    );
  }

  if (openId && (!detail || detail.id !== openId)) {
    return <div>
      <PageHead title="Хэрэглэгчийн түүх" actions={<Button size="sm" variant="outline" onClick={() => setOpenId(null)}>← Буцах</Button>} />
      {detailError ? <><ErrorNote>{detailError}</ErrorNote><Button className="mt-3" variant="outline" onClick={() => setDetailReload((value) => value + 1)}>Дахин оролдох</Button></> : <Skeleton className="h-[240px]" />}
    </div>;
  }

  if (openId && detail) {
    return (
      <div>
        <PageHead
          title={detail.name ?? detail.email ?? "Хэрэглэгч"}
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
        <SearchField value={search} onChange={setSearch} placeholder="Нэр, и-мэйл, утас" className="w-64" />
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
