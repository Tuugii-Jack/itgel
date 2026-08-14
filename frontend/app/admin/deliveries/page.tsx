"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DELIVERY_STATUS_LABEL, Metric, PageHead, Select } from "@/components/admin/shared";
import { Badge, Button, Card, Empty, ErrorNote, Input, Skeleton } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayKey, dayLabel, money, phoneLabel, relativeDay, weekdayShort } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import { groupDeliveriesByDistrict, printDeliveries } from "@/lib/printDeliveries";
import { useToast } from "@/lib/toast";
import type { AdminDelivery, DeliveryStatus } from "@/lib/types";

const STATUSES: DeliveryStatus[] = ["PENDING", "ASSIGNED", "DELIVERED"];

export default function DeliveriesPage() {
  const toast = useToast();
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<AdminDelivery[]>([]);
  const [couriers, setCouriers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const list = await adminApi.deliveries({
        day: day || undefined,
        status: status || undefined,
        pageSize: 200,
      });
      setRows(list);
      setCouriers(Object.fromEntries(list.map((d) => [d.id, d.courierName ?? ""])));
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Ачаалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [day, status, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => groupDeliveriesByDistrict(rows), [rows]);
  const pending = rows.filter((r) => r.status !== "DELIVERED");

  const save = async (id: string, patch: { courierName?: string | null; status?: string }) => {
    setBusy(id);
    setError(null);
    try {
      await adminApi.updateDelivery(id, patch);
      setRows((prev) =>
        prev.map((r) =>
          r.id !== id
            ? r
            : {
                ...r,
                courierName: patch.courierName !== undefined ? patch.courierName : r.courierName,
                status: (patch.status as DeliveryStatus | undefined) ?? r.status,
              },
        ),
      );
      toast.success(
        patch.status
          ? `Төлөв «${DELIVERY_STATUS_LABEL[patch.status as DeliveryStatus]}» боллоо.`
          : "Хүргэлт хадгалагдлаа.",
      );
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const printOpts = { day: day || undefined };

  return (
    <div>
      <PageHead
        title="Хүргэлт"
        hint="Дүүргээр бүлэглэж, хүргэлтийн компанид хэвлэж өгнө"
        actions={
          <Button
            variant="outline"
            disabled={rows.length === 0}
            onClick={() => printDeliveries(rows, printOpts)}
          >
            Бүгдийг хэвлэх
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Нийт хүргэлт" value={rows.length} />
        <Metric label="Хүлээгдэж буй" value={pending.length} tone="warn" />
        <Metric
          label="Хүргэсэн"
          value={rows.filter((r) => r.status === "DELIVERED").length}
          tone="ok"
        />
        <Metric label="Дүүрэг" value={groups.length} />
      </div>

      {groups.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {groups.map((g) => (
            <a
              key={g.district}
              href={`#district-${encodeURIComponent(g.district)}`}
              className="inline-flex items-center gap-2 rounded-[8px] border border-line bg-bg px-3 py-2 text-[13px] text-ink no-underline"
            >
              <span>{g.district}</span>
              <span className="tnum text-muted">{g.rows.length} хүргэлт</span>
            </a>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
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
        {refreshing && <span className="text-[13px] text-muted">Шинэчилж байна…</span>}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-[12px]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty>Хүргэлт олдсонгүй.</Empty>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map(({ district, rows: list }) => (
            <section key={district} id={`district-${encodeURIComponent(district)}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="m-0 text-[17px] font-medium">{district}</h2>
                  <div className="tnum mt-0.5 text-[13px] text-muted">{list.length} хүргэлт</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => printDeliveries(list, { ...printOpts, district })}
                >
                  Хэвлэх
                </Button>
              </div>
              <div className="flex flex-col gap-3">
                {list.map((row) => (
                  <DeliveryCard
                    key={row.id}
                    row={row}
                    courier={couriers[row.id] ?? ""}
                    onCourier={(v) => setCouriers((prev) => ({ ...prev, [row.id]: v }))}
                    busy={busy === row.id}
                    onSave={save}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-4 mb-0 text-[13px] text-muted">
        Хүргэлтийн төлбөрийг хүргэлтийн компани авна. «Хүргэсэн» гэж тэмдэглэхэд захиалга
        «Хүлээлгэн өгсөн» болно.
      </p>
    </div>
  );
}

function DeliveryCard({
  row,
  courier,
  onCourier,
  busy,
  onSave,
}: {
  row: AdminDelivery;
  courier: string;
  onCourier: (v: string) => void;
  busy: boolean;
  onSave: (id: string, patch: { courierName?: string | null; status?: string }) => void;
}) {
  const items = row.order.items ?? [];

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tnum text-[15px] font-medium">{row.order.code}</span>
            <Badge
              tone={
                row.status === "DELIVERED" ? "ok" : row.status === "ASSIGNED" ? "info" : "neutral"
              }
            >
              {DELIVERY_STATUS_LABEL[row.status]}
            </Badge>
          </div>
          <div className="mt-2 text-[16px] font-medium">
            {row.order.customer.name ?? "Нэргүй"}
          </div>
          <a href={`tel:${row.order.customer.phone ?? ""}`} className="tnum mt-0.5 block text-[15px]">
            {phoneLabel(row.order.customer.phone)}
          </a>
          <div className="mt-2 text-[14px]">
            {row.district}
            {row.khoroo ? `, ${row.khoroo}` : ""}
          </div>
          {row.addressText && (
            <div className="mt-0.5 text-[14px] leading-[1.45] text-ink">{row.addressText}</div>
          )}
          {items.length > 0 && (
            <ul className="mt-3 mb-0 flex list-none flex-col gap-1 p-0">
              {items.map((item, i) => {
                const sel = formatSelections(item.selections, item.size, item.color);
                return (
                  <li key={`${item.name}-${i}`} className="text-[13px] leading-[1.4] text-ink-2">
                    {item.name}
                    {sel ? ` · ${sel}` : ""}
                    <span className="tnum"> × {item.qty}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {row.order.note && (
            <div className="mt-2 text-[13px] text-ink-2">Тэмдэглэл: {row.order.note}</div>
          )}
        </div>

        <div className="text-right">
          <div className="tnum text-[13px] text-ink-2">
            {weekdayShort(row.scheduledDay)} · {dayLabel(row.scheduledDay)}
          </div>
          <div className="text-[12px] text-muted">{relativeDay(row.scheduledDay)}</div>
          {row.order.dueAmount > 0 && (
            <div className="tnum mt-2 text-[13px] text-warn">
              Үлдэгдэл {money(row.order.dueAmount)}
            </div>
          )}
        </div>
      </div>

      {row.status !== "DELIVERED" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <div className="min-w-[180px] flex-1">
            <Input value={courier} onChange={onCourier} placeholder="Жолоочийн нэр" />
          </div>
          <Button
            variant="outline"
            onClick={() =>
              onSave(row.id, {
                courierName: courier.trim() || null,
                status: courier.trim() ? "ASSIGNED" : "PENDING",
              })
            }
            loading={busy}
          >
            Хадгалах
          </Button>
          <Button onClick={() => onSave(row.id, { status: "DELIVERED" })} loading={busy}>
            Хүргэсэн
          </Button>
        </div>
      )}
    </Card>
  );
}
