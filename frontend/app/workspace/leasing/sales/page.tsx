"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useState } from "react";
import { Metric, PageHead, Table, Td, Th } from "@/components/admin/shared";
import { Button, Card, Empty, ErrorNote, Input, Skeleton } from "@/components/ui";
import { leasingApi, ApiError } from "@/lib/api";
import { isOwner } from "@/lib/admin-role";
import { useAdminSession } from "@/lib/admin-session";
import { customerNameLabel, dayLabel, money, phoneLabel } from "@/lib/format";

type SalesRow = Awaited<ReturnType<typeof leasingApi.readySales>>["rows"][number];

const PAY_LABEL: Record<string, string> = {
  UNPAID: "Төлөөгүй",
  PARTIAL: "Хэсэгчилсэн",
  PAID: "Төлсөн",
  OVERPAID: "Илүү",
  REFUNDED: "Буцаасан",
};

export default function LeasingSalesPage() {
  const { user } = useAdminSession();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [totals, setTotals] = useState<{
    received: number;
    refunded: number;
    net: number;
    receivable: number;
  } | null>(null);
  const [stock, setStock] = useState<{
    onHand: number;
    reserved: number;
    available: number;
  } | null>(null);
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [data, stockSummary] = await Promise.all([
        leasingApi.readySales({
          from: from || undefined,
          to: to || undefined,
          status: status || undefined,
          page: 1,
          pageSize: 50,
        }),
        leasingApi.readyStock().catch(() => null),
      ]);
      setTotals(data.totals);
      setRows(data.rows);
      if (stockSummary) setStock(stockSummary);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [from, to, status]);

  useEffect(() => deferEffect(() => { void load(); }), [load]);

  return (
    <div>
      <PageHead
        title="Бэлэн барааны борлуулалт"
        hint={
          isOwner(user?.role)
            ? "Бүх эзний бэлэн барааны борлуулалт. Орлого давхар тооцогдохгүй."
            : "Зөвхөн өөрийн бэлэн бараа. Орлого нь бодит төлбөр, буцаалтаас гарна — ашиг биш."
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Metric label="Гарт" value={stock?.onHand ?? 0} />
        <Metric label="Түр нөөц" value={stock?.reserved ?? 0} />
        <Metric label="Боломжтой" value={stock?.available ?? 0} tone="ok" />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Орсон мөнгө" value={money(totals?.received ?? 0)} tone="ok" />
        <Metric label="Буцаасан" value={money(totals?.refunded ?? 0)} />
        <Metric label="Цэвэр орлого" value={money(totals?.net ?? 0)} />
        <Metric label="Авах үлдэгдэл" value={money(totals?.receivable ?? 0)} tone="warn" />
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Эхлэл
          <Input type="date" value={from} onChange={setFrom} className="w-40" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Төгсгөл
          <Input type="date" value={to} onChange={setTo} className="w-40" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Төлөв
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-10 rounded-[8px] border border-line bg-bg px-3 text-[14px]"
          >
            <option value="">Бүгд</option>
            <option value="NEW">Шинэ</option>
            <option value="CONFIRMED">Баталгаажсан</option>
            <option value="CANCELLED">Цуцлагдсан</option>
            <option value="HANDED_OVER">Хүлээлгэсэн</option>
          </select>
        </label>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Шүүх
        </Button>
      </div>
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {loading ? (
        <Skeleton className="h-40 w-full rounded-[12px]" />
      ) : rows.length === 0 ? (
        <Empty>Энэ шүүлтээр борлуулалт алга.</Empty>
      ) : (
        <Card className="overflow-x-auto p-0">
          <Table>
            <thead>
              <tr>
                <Th>Огноо</Th>
                <Th>Захиалга</Th>
                <Th>Худалдан авагч</Th>
                <Th>Бараа</Th>
                <Th>Дүн</Th>
                <Th>Төлбөр</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td className="whitespace-nowrap">{dayLabel(row.createdAt)}</Td>
                  <Td className="tnum">{row.code}</Td>
                  <Td>
                    <div>{customerNameLabel(row.customer.name)}</div>
                    <div className="text-[12px] text-ink-2">{phoneLabel(row.customer.phone)}</div>
                  </Td>
                  <Td>
                    {row.items.map((item) => (
                      <div key={item.id} className={item.cancelled ? "text-muted line-through" : ""}>
                        {item.name} · {item.qty} ш
                      </div>
                    ))}
                    {row.sourceTransfer && (
                      <div className="mt-1 text-[12px] text-ink-2">
                        Лизингээс шилжсэн · өмнөх төлбөр {money(row.sourceTransfer.paidKeptAmount)}
                      </div>
                    )}
                  </Td>
                  <Td className="tnum">{money(row.paidAmount)}</Td>
                  <Td>
                    {PAY_LABEL[row.paymentState] ?? row.paymentState}
                    {row.refundedAmount > 0 && (
                      <div className="text-[12px] text-danger">буцаасан {money(row.refundedAmount)}</div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
