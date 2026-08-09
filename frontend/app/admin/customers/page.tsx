"use client";

import { useCallback, useEffect, useState } from "react";
import { Metric, PageHead, Table, Td, Th } from "@/components/admin/shared";
import { Card, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayLabel, money, phoneLabel } from "@/lib/format";
import type { AdminCustomer } from "@/lib/types";

export default function CustomersPage() {
  const [rows, setRows] = useState<AdminCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminApi.customers({ q: query || undefined, pageSize: 100 });
      setRows(list.data);
      setTotal(list.meta?.total ?? list.data.length);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const spent = rows.reduce((sum, r) => sum + r.totalSpent, 0);
  const repeat = rows.filter((r) => r.orderCount > 1).length;

  return (
    <div>
      <PageHead title="Хэрэглэгчид" hint="Утасны дугаараар бүртгэгддэг" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Нийт хэрэглэгч" value={total} />
        <Metric label="Давтан захиалагч" value={repeat} tone="ok" />
        <Metric label="Нийт зарцуулалт" value={money(spent)} />
        <Metric
          label="Дундаж"
          value={money(rows.length ? Math.round(spent / rows.length) : 0)}
        />
      </div>

      <div className="mb-4 max-w-[360px]">
        <Input value={search} onChange={setSearch} placeholder="Нэр эсвэл утасны дугаар" />
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
                  <tr key={row.id}>
                    <Td>{row.name ?? "—"}</Td>
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
              <Card key={row.id} className="p-4">
                <div className="text-[15px]">{row.name ?? "Нэргүй"}</div>
                <div className="tnum text-[13px] text-muted">{phoneLabel(row.phone)}</div>
                <div className="mt-2 flex items-baseline justify-between text-[13px]">
                  <span className="text-muted">{row.orderCount} захиалга</span>
                  <span className="tnum">{money(row.totalSpent)}</span>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
