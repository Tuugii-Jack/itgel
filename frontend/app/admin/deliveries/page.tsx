"use client";

import { useCallback, useEffect, useState } from "react";
import { DELIVERY_STATUS_LABEL, Metric, PageHead, Select } from "@/components/admin/shared";
import { Badge, Button, Card, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayKey, dayLabel, money, phoneLabel, relativeDay } from "@/lib/format";
import type { AdminDelivery, DeliveryStatus } from "@/lib/types";

const STATUSES: DeliveryStatus[] = ["PENDING", "ASSIGNED", "DELIVERED"];

export default function DeliveriesPage() {
  const [day, setDay] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<AdminDelivery[]>([]);
  const [couriers, setCouriers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await adminApi.deliveries({
        day: day || undefined,
        status: status || undefined,
      });
      setRows(list);
      setCouriers(
        Object.fromEntries(list.map((d) => [d.id, d.courierName ?? ""])),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [day, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (id: string, patch: { courierName?: string | null; status?: string }) => {
    setBusy(id);
    setError(null);
    try {
      await adminApi.updateDelivery(id, patch);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Хадгалж чадсангүй.");
    } finally {
      setBusy(null);
    }
  };

  const pending = rows.filter((r) => r.status !== "DELIVERED");

  return (
    <div>
      <PageHead title="Хүргэлт" hint="Өдрөөр шүүж, жолооч хуваарилна" />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Нийт" value={rows.length} />
        <Metric label="Хүлээгдэж буй" value={pending.length} tone="warn" />
        <Metric
          label="Хүргэсэн"
          value={rows.filter((r) => r.status === "DELIVERED").length}
          tone="ok"
        />
        <Metric
          label="Авах дүн"
          value={money(pending.reduce((sum, r) => sum + r.order.dueAmount, 0))}
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="h-11 rounded-[8px] border border-line bg-bg px-3 text-[14px]"
        />
        <Select
          value={status}
          onChange={setStatus}
          placeholder="Бүх төлөв"
          options={STATUSES.map((s) => ({ value: s, label: DELIVERY_STATUS_LABEL[s] }))}
        />
        <Button variant="outline" onClick={() => setDay(dayKey(new Date()))}>
          Өнөөдөр
        </Button>
        {(day || status) && (
          <Button
            variant="ghost"
            onClick={() => {
              setDay("");
              setStatus("");
            }}
          >
            Цэвэрлэх
          </Button>
        )}
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
        <Empty>Хүргэлт олдсонгүй.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <Card key={row.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="tnum text-[15px] font-medium">{row.order.code}</span>
                    <Badge
                      tone={
                        row.status === "DELIVERED"
                          ? "ok"
                          : row.status === "ASSIGNED"
                            ? "info"
                            : "neutral"
                      }
                    >
                      {DELIVERY_STATUS_LABEL[row.status]}
                    </Badge>
                  </div>
                  <div className="mt-1 text-[14px]">
                    {row.district}
                    {row.khoroo ? `, ${row.khoroo}` : ""}
                  </div>
                  {row.addressText && (
                    <div className="text-[13px] text-ink-2">{row.addressText}</div>
                  )}
                  <div className="mt-1 text-[13px] text-muted">
                    {row.order.customer.name ?? "Нэргүй"} ·{" "}
                    <a href={`tel:${row.order.customer.phone}`} className="tnum">
                      {phoneLabel(row.order.customer.phone)}
                    </a>
                  </div>
                </div>

                <div className="text-right">
                  <div className="tnum text-[13px] text-ink-2">
                    {dayLabel(row.scheduledDay)} · {relativeDay(row.scheduledDay)}
                  </div>
                  <div className="tnum text-[15px]">{money(row.fee)}</div>
                  {row.order.dueAmount > 0 && (
                    <div className="tnum text-[13px] text-warn">
                      Авах {money(row.order.dueAmount)}
                    </div>
                  )}
                </div>
              </div>

              {row.status !== "DELIVERED" && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <div className="min-w-[180px] flex-1">
                    <Input
                      value={couriers[row.id] ?? ""}
                      onChange={(v) => setCouriers((prev) => ({ ...prev, [row.id]: v }))}
                      placeholder="Жолоочийн нэр"
                    />
                  </div>
                  <Button
                    variant="outline"
                    onClick={() =>
                      save(row.id, {
                        courierName: couriers[row.id]?.trim() || null,
                        status: couriers[row.id]?.trim() ? "ASSIGNED" : "PENDING",
                      })
                    }
                    loading={busy === row.id}
                  >
                    Хадгалах
                  </Button>
                  <Button
                    onClick={() => save(row.id, { status: "DELIVERED" })}
                    loading={busy === row.id}
                  >
                    Хүргэсэн
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <p className="mt-4 mb-0 text-[13px] text-muted">
        «Хүргэсэн» гэж тэмдэглэхэд захиалга автоматаар «Хүлээлгэн өгсөн» болж, үлдэгдэл
        төлбөр хаагдана.
      </p>
    </div>
  );
}
