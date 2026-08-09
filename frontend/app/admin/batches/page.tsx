"use client";

import { useCallback, useEffect, useState } from "react";
import { BATCH_STAGE_LABEL, Metric, OrderBadge, PageHead } from "@/components/admin/shared";
import { Badge, Button, Card, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayLabel, money, rangeLabel } from "@/lib/format";
import type { AdminBatch, BatchStage, OrderStatus } from "@/lib/types";

const STAGES: BatchStage[] = [
  "COLLECTING",
  "CLOSED",
  "AT_SUPPLIER",
  "IN_TRANSIT",
  "AT_WAREHOUSE",
  "DONE",
];

interface BatchOrders {
  id: string;
  code: string;
  status: string;
  subtotal: number;
  itemCount: number;
  customer: { name: string | null; phone: string };
}

export default function BatchesPage() {
  const [batches, setBatches] = useState<AdminBatch[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [orders, setOrders] = useState<BatchOrders[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminApi.batches({ pageSize: 100 });
      setBatches(list.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setOrders([]);
    try {
      const detail = await adminApi.batch(id);
      setOrders(detail.orders);
    } catch {
      setOrders([]);
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.createBatch({ name: name.trim() });
      setName("");
      setCreating(false);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Багц үүсгэж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const advance = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.advanceBatch(id);
      await load();
      if (openId === id) await open(id);
      setError(
        result.ordersMoved > 0
          ? null
          : "Шат ахилаа. Захиалгын төлөв өөрчлөгдөөгүй (энэ шатанд шаардлагагүй).",
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Шат ахиулж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const active = batches.filter((b) => b.stage !== "DONE");

  return (
    <div>
      <PageHead
        title="Багц"
        hint="Захиалгуудыг багцлан тээвэрлэнэ. Шат ахихад захиалгын төлөв автоматаар дагана."
        actions={
          <Button onClick={() => setCreating((v) => !v)}>
            {creating ? "Болих" : "Багц үүсгэх"}
          </Button>
        }
      />

      {creating && (
        <Card className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <div className="mb-1.5 text-[13px] text-ink-2">Багцын нэр</div>
            <Input value={name} onChange={setName} placeholder="Жишээ: 5-р багц — 8 сар" />
          </div>
          <Button onClick={create} loading={busy} disabled={!name.trim()}>
            Үүсгэх
          </Button>
        </Card>
      )}

      <p className="mt-0 mb-4 text-[13px] text-muted">
        Багц үүсгэхэд багцгүй, баталгаажсан бүх захиалга автоматаар орно.
      </p>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Идэвхтэй багц" value={active.length} />
        <Metric
          label="Багц дахь захиалга"
          value={active.reduce((sum, b) => sum + b.orderCount, 0)}
        />
        <Metric
          label="Нийт дүн"
          value={money(active.reduce((sum, b) => sum + b.totalValue, 0))}
        />
        <Metric
          label="Жин"
          value={`${active.reduce((sum, b) => sum + (b.weightKg ?? 0), 0)} кг`}
        />
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
      ) : batches.length === 0 ? (
        <Empty>Багц алга байна.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {batches.map((batch) => (
            <Card key={batch.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[15px] font-medium">{batch.name}</div>
                  <div className="text-[13px] text-muted">
                    {batch.orderCount} захиалга · {money(batch.totalValue)}
                    {batch.weightKg ? ` · ${batch.weightKg} кг` : ""}
                  </div>
                </div>
                <Badge tone={batch.stage === "DONE" ? "ok" : "info"}>
                  {BATCH_STAGE_LABEL[batch.stage]}
                </Badge>
              </div>

              <div className="mt-3 flex gap-1">
                {STAGES.map((stage) => {
                  const index = STAGES.indexOf(batch.stage);
                  const passed = STAGES.indexOf(stage) <= index;
                  return (
                    <span
                      key={stage}
                      title={BATCH_STAGE_LABEL[stage]}
                      className={`h-1 flex-1 rounded-full ${passed ? "bg-ink" : "bg-line"}`}
                    />
                  );
                })}
              </div>

              {(batch.etaFrom || batch.closedAt) && (
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-2">
                  {batch.closedAt && (
                    <span className="tnum">Хаагдсан: {dayLabel(batch.closedAt)}</span>
                  )}
                  {batch.etaFrom && batch.etaTo && (
                    <span className="tnum">ETA: {rangeLabel(batch.etaFrom, batch.etaTo)}</span>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => open(batch.id)}>
                  {openId === batch.id ? "Хаах" : "Захиалгууд"}
                </Button>
                {batch.nextStage && (
                  <Button size="sm" onClick={() => advance(batch.id)} disabled={busy}>
                    {BATCH_STAGE_LABEL[batch.nextStage]} рүү
                  </Button>
                )}
              </div>

              {openId === batch.id && (
                <div className="mt-3 border-t border-line pt-3">
                  {orders.length === 0 ? (
                    <div className="text-[13px] text-muted">Захиалга алга.</div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {orders.map((order) => (
                        <div
                          key={order.id}
                          className="flex flex-wrap items-center justify-between gap-2 text-[13px]"
                        >
                          <span className="tnum">{order.code}</span>
                          <span className="text-ink-2">
                            {order.customer.name ?? "Нэргүй"} · {order.itemCount} ш
                          </span>
                          <span className="tnum">{money(order.subtotal)}</span>
                          <OrderBadge status={order.status as OrderStatus} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
