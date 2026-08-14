"use client";

import { useCallback, useEffect, useState } from "react";
import { ProductImage } from "@/components/ProductImage";
import { OrderDetail } from "@/components/admin/OrderDetail";
import {
  BATCH_STAGE_LABEL,
  Metric,
  OrderBadge,
  PageHead,
  ProductStatusBadge,
  Table,
  Td,
  Th,
} from "@/components/admin/shared";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Input,
  Skeleton,
  Spinner,
} from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { PAYMENT_LABEL_SHORT, PAYMENT_TONE } from "@/lib/payment";
import { useToast } from "@/lib/toast";
import { dayLabel, money, rangeLabel } from "@/lib/format";
import type {
  AdminBatch,
  AdminBatchDetail,
  BatchOrderRow,
  BatchProduct,
  BatchStage,
} from "@/lib/types";

const STAGES: BatchStage[] = ["IN_TRANSIT", "AT_WAREHOUSE", "DONE"];

function parseCargo(raw: string | undefined): number {
  return Math.max(0, Math.round(Number((raw ?? "").replace(/[^\d]/g, "") || "0")));
}

const MONTH_LABELS = [
  "1-р сар",
  "2-р сар",
  "3-р сар",
  "4-р сар",
  "5-р сар",
  "6-р сар",
  "7-р сар",
  "8-р сар",
  "9-р сар",
  "10-р сар",
  "11-р сар",
  "12-р сар",
];

/** Огноог input[type=date]-д тохирох хэлбэрт. */
function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export default function BatchesPage() {
  const toast = useToast();
  const [batches, setBatches] = useState<AdminBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Нээлттэй багц — жагсаалтын оронд дэлгэрэнгүй харагдана. */
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  /** Багцын дотроос нээсэн захиалга. */
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const list = await adminApi.batches({ pageSize: 100 });
      setBatches(list.data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // OrderDetail-аас холбоосоор ирсэн багцыг нээнэ.
  useEffect(() => {
    try {
      const id = sessionStorage.getItem("itgel.admin.openBatch");
      if (id) {
        sessionStorage.removeItem("itgel.admin.openBatch");
        setOpenBatchId(id);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const active = batches.filter((b) => b.stage !== "DONE");

  if (openOrderId) {
    return (
      <OrderDetail
        orderId={openOrderId}
        onClose={() => setOpenOrderId(null)}
        onChanged={() => void load(true)}
      />
    );
  }

  if (openBatchId) {
    return (
      <BatchDetail
        batchId={openBatchId}
        onBack={() => {
          setOpenBatchId(null);
          void load(true);
        }}
        onOpenOrder={setOpenOrderId}
        onListChanged={() => void load(true)}
      />
    );
  }

  return (
    <div>
      <PageHead
        title="Ачааны багц"
        hint="Ирсэн хаагдсан барааг он/сараар сонгож багцад хийгээд Зам дээр → Агуулахад → Дууссан урагшлуулна."
        actions={
          <Button onClick={() => setCreating((v) => !v)}>
            {creating ? "Болих" : "Багц үүсгэх"}
          </Button>
        }
      />

      {creating && (
        <CreateBatchForm
          onCreated={(batch) => {
            setCreating(false);
            setBatches((prev) => [batch, ...prev]);
            setOpenBatchId(batch.id);
            toast.success("Багц үүслээ. Хаагдсан бараагаа сараар нэмээрэй.");
          }}
        />
      )}

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
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      ) : batches.length === 0 ? (
        <Empty>Багц алга байна. «Багц үүсгэх» товчоор эхлүүлээрэй.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {batches.map((batch) => (
            <button
              key={batch.id}
              type="button"
              onClick={() => setOpenBatchId(batch.id)}
              className="cursor-pointer rounded-[12px] border border-line bg-bg p-4 text-left transition-colors hover:border-ink/30"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[15px] font-medium">{batch.name}</div>
                  <div className="mt-0.5 text-[13px] text-muted">
                    {batch.orderCount} захиалга · {money(batch.totalValue)}
                    {batch.weightKg ? ` · ${batch.weightKg} кг` : ""}
                  </div>
                </div>
                <Badge tone={batch.stage === "DONE" ? "ok" : "info"}>
                  {BATCH_STAGE_LABEL[batch.stage]}
                </Badge>
              </div>

              <StageBar stage={batch.stage} />

              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-2">
                {batch.deadline && (
                  <span className="tnum">Захиалга хаагдах: {dayLabel(batch.deadline)}</span>
                )}
                {batch.closedAt && (
                  <span className="tnum">Хаагдсан: {dayLabel(batch.closedAt)}</span>
                )}
                {batch.etaFrom && batch.etaTo && (
                  <span className="tnum">Ирэх: {rangeLabel(batch.etaFrom, batch.etaTo)}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StageBar({ stage }: { stage: BatchStage }) {
  const index = STAGES.indexOf(stage);
  return (
    <div className="mt-3 flex gap-1">
      {STAGES.map((s, i) => (
        <span
          key={s}
          title={BATCH_STAGE_LABEL[s]}
          className={`h-1 flex-1 rounded-full ${index >= 0 && i <= index ? "bg-ink" : "bg-line"}`}
        />
      ))}
    </div>
  );
}

function CreateBatchForm({ onCreated }: { onCreated: (batch: AdminBatch) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const batch = await adminApi.createBatch({ name: name.trim() });
      onCreated({
        ...batch,
        orderCount: 0,
        totalValue: 0,
        nextStage: "AT_WAREHOUSE",
        previousStage: null,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Багц үүсгэж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <div className="mb-1.5 text-[13px] text-ink-2">Багцын нэр</div>
          <Input value={name} onChange={setName} placeholder="Жишээ: 8-р сарын ачаа" />
        </div>
        <Button onClick={create} loading={busy} disabled={!name.trim()}>
          Үүсгэх
        </Button>
      </div>
      <p className="mt-2 mb-0 text-[12px] text-muted">
        Багц «Зам дээр» шатаас эхэлнэ. Дараа нь хаагдсан гаргалтыг он/сараар сонгож нэмнэ.
      </p>
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Card>
  );
}

/** Нэг багцын дэлгэрэнгүй — бараа, захиалга, шат бүгд нэг дор. */
function BatchDetail({
  batchId,
  onBack,
  onOpenOrder,
  onListChanged,
}: {
  batchId: string;
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
  onListChanged: () => void;
}) {
  const toast = useToast();
  const [batch, setBatch] = useState<AdminBatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cargoDraft, setCargoDraft] = useState<Record<string, string>>({});

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      setBatch(await adminApi.batch(batchId));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const advance = async () => {
    if (!batch?.nextStage) return;
    setBusyKey("advance");
    try {
      await adminApi.advanceBatch(batch.id);
      await load(true);
      onListChanged();
      toast.success(`Багц «${BATCH_STAGE_LABEL[batch.nextStage]}» шатанд орлоо.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Шат ахиулж чадсангүй.");
    } finally {
      setBusyKey(null);
    }
  };

  const revert = async () => {
    if (!batch?.previousStage) return;
    setBusyKey("revert");
    try {
      await adminApi.revertBatchStage(batch.id);
      await load(true);
      onListChanged();
      toast.success(`Багц «${BATCH_STAGE_LABEL[batch.previousStage]}» шат руу буцлаа.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Шат буцааж чадсангүй.");
    } finally {
      setBusyKey(null);
    }
  };

  const removeProduct = async (roundId: string, name: string) => {
    setBusyKey(`remove:${roundId}`);
    try {
      await adminApi.removeBatchProduct(batchId, roundId);
      setBatch((prev) =>
        prev ? { ...prev, products: prev.products.filter((p) => p.roundId !== roundId) } : prev,
      );
      toast.success(`«${name}» багцаас салгалаа.`);
      await load(true);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Хасаж чадсангүй.");
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <div>
        <Skeleton className="mb-4 h-9 w-40" />
        <Skeleton className="mb-3 h-[120px]" />
        <Skeleton className="mb-3 h-[200px]" />
        <Skeleton className="h-[200px]" />
      </div>
    );
  }

  if (!batch) {
    return (
      <div>
        <Button variant="outline" size="sm" onClick={onBack}>
          ← Буцах
        </Button>
        <div className="mt-4">
          <ErrorNote>{error ?? "Багц олдсонгүй."}</ErrorNote>
        </div>
      </div>
    );
  }

  const editable = batch.stage === "IN_TRANSIT";
  const canEditCargo = batch.stage === "IN_TRANSIT";
  const canOmit = editable;
  const unpaidCount = batch.orders.filter(
    (o) => (o.paidAmount ?? 0) < o.subtotal,
  ).length;

  const saveCargo = async () => {
    if (!batch) return;
    const items = batch.products.map((p) => ({
      roundId: p.roundId,
      cargoFee:
        p.roundId in cargoDraft
          ? parseCargo(cargoDraft[p.roundId])
          : (p.cargoFee ?? 0),
    }));
    setBusyKey("cargo");
    try {
      const result = await adminApi.saveBatchCargoFees(batch.id, items);
      setCargoDraft({});
      toast.success(
        result.ordersUpdated > 0
          ? `Карго хадгалагдлаа · ${result.ordersUpdated} захиалга шинэчлэгдлээ.`
          : "Карго хадгалагдлаа.",
      );
      await load(true);
      onListChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Карго хадгалж чадсангүй.");
    } finally {
      setBusyKey(null);
    }
  };

  const omitOrder = async (order: BatchOrderRow) => {
    setBusyKey(`omit:${order.id}`);
    try {
      await adminApi.omitBatchOrder(batchId, order.id);
      toast.success(`${order.code} багцаас хаслаа.`);
      await load(true);
      onListChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Хасаж чадсангүй.");
    } finally {
      setBusyKey(null);
    }
  };

  const reinstateOrder = async (order: BatchOrderRow) => {
    setBusyKey(`reinstate:${order.id}`);
    try {
      await adminApi.reinstateBatchOrder(batchId, order.id);
      toast.success(`${order.code} дахин орлоо — хүлээж авахад бэлэн.`);
      await load(true);
      onListChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Оруулж чадсангүй.");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={onBack}>
          ← Багцууд
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
            {editing ? "Болих" : "Засах"}
          </Button>
          {batch.previousStage && (
            <Button size="sm" variant="outline" onClick={revert} loading={busyKey === "revert"}>
              «{BATCH_STAGE_LABEL[batch.previousStage]}» руу буцаах
            </Button>
          )}
          {batch.nextStage && (
            <Button size="sm" onClick={advance} loading={busyKey === "advance"}>
              {BATCH_STAGE_LABEL[batch.nextStage]} рүү шилжүүлэх
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 text-[20px] font-medium">{batch.name}</h1>
          <Badge tone={batch.stage === "DONE" ? "ok" : "info"}>
            {BATCH_STAGE_LABEL[batch.stage]}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-2">
          {batch.deadline && (
            <span className="tnum">Захиалга хаагдах: {dayLabel(batch.deadline)}</span>
          )}
          {batch.etaFrom && batch.etaTo && (
            <span className="tnum">Ирэх: {rangeLabel(batch.etaFrom, batch.etaTo)}</span>
          )}
          {batch.weightKg != null && <span className="tnum">{batch.weightKg} кг</span>}
        </div>
      </div>

      {editing && (
        <EditBatchForm
          batch={batch}
          onSaved={(updated) => {
            setBatch((prev) => (prev ? { ...prev, ...updated } : prev));
            setEditing(false);
            onListChanged();
            toast.success("Багцын мэдээлэл хадгалагдлаа.");
          }}
        />
      )}

      {/* Шатны зам — аль шатанд явааг нэг харцаар. */}
      <Card className="mb-4 p-4">
        <div className="flex items-center">
          {STAGES.map((stage, i) => {
            const index = Math.max(STAGES.indexOf(batch.stage), 0);
            const passed = STAGES.includes(batch.stage) && i < index;
            const current = stage === batch.stage;
            return (
              <div key={stage} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full items-center">
                  <span
                    className={`h-[2px] flex-1 ${i === 0 ? "opacity-0" : passed || current ? "bg-ink" : "bg-line"}`}
                  />
                  <span
                    className={`h-3 w-3 shrink-0 rounded-full border-2
                      ${current ? "border-ink bg-ink" : passed ? "border-ink bg-ink" : "border-line bg-bg"}`}
                  />
                  <span
                    className={`h-[2px] flex-1 ${i === STAGES.length - 1 ? "opacity-0" : passed ? "bg-ink" : "bg-line"}`}
                  />
                </div>
                <span
                  className={`px-1 text-center text-[11px] leading-tight ${current ? "font-medium text-ink" : "text-muted"}`}
                >
                  {BATCH_STAGE_LABEL[stage]}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Бараа" value={batch.products.length} />
        <Metric label="Захиалга" value={batch.orders.length} />
        <Metric label="Нийт дүн" value={money(batch.totalValue)} />
        <Metric label="Карго" value={money(batch.totalCargo ?? 0)} />
        <Metric
          label="Дутуу төлбөр"
          value={money(batch.totalDue)}
          tone={batch.totalDue > 0 ? "warn" : "ok"}
        />
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {/* --- Багцын бараанууд --- */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="m-0 text-[16px] font-medium">Багцын бараа</h2>
        {editable && (
          <Button size="sm" onClick={() => setPicking((v) => !v)}>
            {picking ? "Болих" : "Бараа нэмэх"}
          </Button>
        )}
      </div>

      {picking && (
        <ClosedRoundPicker
          batch={batch}
          onAdded={(products) => {
            setBatch((prev) =>
              prev
                ? {
                    ...prev,
                    products: [
                      ...prev.products,
                      ...products.filter(
                        (p) => !prev.products.some((x) => x.roundId === p.roundId),
                      ),
                    ],
                  }
                : prev,
            );
            toast.success(`${products.length} гаргалт багцад нэмэгдлээ.`);
            void load(true);
            onListChanged();
          }}
        />
      )}

      {batch.products.length === 0 ? (
        <Empty>
          {editable
            ? "Бараа нэмээгүй байна. «Бараа нэмэх» товчоор хаагдсан гаргалтыг сараар сонгоорой."
            : "Энэ багцад бараа холбогдоогүй."}
        </Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Бараа</Th>
              <Th className="text-right">Зарах үнэ</Th>
              <Th>Хаагдсан</Th>
              <Th className="text-right">Захиалга</Th>
              <Th>Төлөв</Th>
              {editable && <Th />}
            </tr>
          </thead>
          <tbody>
            {batch.products.map((p) => (
              <tr key={p.roundId}>
                <Td>
                  <div className="flex items-center gap-2.5">
                    <ProductImage
                      src={p.image}
                      alt={p.name}
                      className="h-10 w-10 shrink-0 rounded-[8px]"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[14px]">{p.name}</div>
                      <div className="text-[12px] text-muted">#{p.roundNo}-р гаргалт</div>
                    </div>
                  </div>
                </Td>
                <Td className="text-right">
                  <span className="tnum">{money(p.sellPrice)}</span>
                </Td>
                <Td>
                  <span className="tnum text-[13px]">
                    {p.closeAt ? dayLabel(p.closeAt) : "—"}
                  </span>
                </Td>
                <Td className="text-right">
                  <span className="tnum">
                    {p.orderedQty} ш · {p.customerCount} хүн
                  </span>
                </Td>
                <Td>
                  <ProductStatusBadge status={p.status} />
                </Td>
                {editable && (
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeProduct(p.roundId, p.name)}
                      loading={busyKey === `remove:${p.roundId}`}
                    >
                      Хасах
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {batch.products.length > 0 && (
        <Card className="mt-4 p-4">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[16px] font-medium">Карго үнэ</div>
              <p className="m-0 mt-1 text-[13px] text-muted">
                {canEditCargo
                  ? "Бараа бүрийн нэгж карго үнийг оруулаад хадгална. Агуулахад орсны дараа солих боломжгүй."
                  : "Агуулахад орсон тул карго үнийг өөрчлөх боломжгүй."}
              </p>
            </div>
            {canEditCargo && (
              <Button
                size="sm"
                onClick={() => void saveCargo()}
                loading={busyKey === "cargo"}
              >
                Карго хадгалах
              </Button>
            )}
          </div>

          <div className="mt-3 flex flex-col gap-3">
            {batch.products.map((p) => {
              const unit =
                p.roundId in cargoDraft
                  ? parseCargo(cargoDraft[p.roundId])
                  : p.cargoFee ?? 0;
              return (
                <div
                  key={p.roundId}
                  className="flex flex-col gap-2 rounded-[8px] border border-line p-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <ProductImage
                      src={p.image}
                      alt={p.name}
                      className="h-10 w-10 shrink-0 rounded-[8px]"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[14px]">{p.name}</div>
                      <div className="text-[12px] text-muted">
                        {p.orderedQty} ш · {p.customerCount} хүн
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 sm:w-[280px] sm:shrink-0">
                    {canEditCargo ? (
                      <div className="flex-1">
                        <div className="mb-1 text-[12px] text-muted">Нэгж карго ₮</div>
                        <Input
                          value={
                            p.roundId in cargoDraft
                              ? cargoDraft[p.roundId]!
                              : p.cargoFee
                                ? String(p.cargoFee)
                                : ""
                          }
                          onChange={(v) => {
                            setCargoDraft((prev) => ({
                              ...prev,
                              [p.roundId]: v.replace(/[^\d]/g, ""),
                            }));
                          }}
                          placeholder="0"
                          inputMode="numeric"
                        />
                      </div>
                    ) : (
                      <div className="flex-1">
                        <div className="text-[12px] text-muted">Нэгж карго</div>
                        <div className="tnum text-[15px] font-medium">
                          {p.cargoFee ? money(p.cargoFee) : "—"}
                        </div>
                      </div>
                    )}
                    <div className="w-[110px] text-right">
                      <div className="text-[12px] text-muted">Нийт</div>
                      <div className="tnum text-[15px] font-medium">
                        {money(p.orderedQty * unit)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <span className="text-[14px] text-ink-2">Багцын нийт карго</span>
            <span className="tnum text-[18px] font-medium">
              {money(
                batch.products.reduce((sum, p) => {
                  const unit =
                    p.roundId in cargoDraft
                      ? parseCargo(cargoDraft[p.roundId])
                      : p.cargoFee ?? 0;
                  return sum + p.orderedQty * unit;
                }, 0),
              )}
            </span>
          </div>
        </Card>
      )}

      {/* --- Багцын захиалгууд --- */}
      <h2 className="mt-6 mb-2 text-[16px] font-medium">Захиалгууд</h2>
      {unpaidCount > 0 && (
        <Card className="mb-3 border-warn bg-warn-bg p-3">
          <div className="text-[13px] text-warn">
            <span className="tnum font-medium">{unpaidCount}</span> захиалгын төлбөр дутуу
            {editable && " — урагшлуулахгүй бол «Хасах»."}
          </div>
        </Card>
      )}
      {batch.orders.length === 0 ? (
        <Empty>Захиалга алга. Хаагдсан гаргалт нэмэхэд захиалгууд энд орно.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Код</Th>
              <Th>Харилцагч</Th>
              <Th className="text-right">Дүн</Th>
              <Th>Төлбөр</Th>
              <Th>Төлөв</Th>
              {canOmit && <Th className="text-right" />}
            </tr>
          </thead>
          <tbody>
            {batch.orders.map((order) => (
              <tr
                key={order.id}
                onClick={() => onOpenOrder(order.id)}
                className="cursor-pointer transition-colors hover:bg-surface"
              >
                <Td>
                  <span className="tnum text-[13px] underline underline-offset-2">
                    {order.code}
                  </span>
                </Td>
                <Td>
                  <div className="text-[14px]">{order.customer.name ?? "Нэргүй"}</div>
                  <div className="tnum text-[12px] text-muted">{order.customer.phone}</div>
                </Td>
                <Td className="text-right">
                  <span className="tnum">{money(order.subtotal)}</span>
                  <div className="text-[12px] text-muted">{order.itemCount} ш</div>
                </Td>
                <Td onClick={(e) => e.stopPropagation()}>
                  <Badge tone={PAYMENT_TONE[order.paymentState]}>
                    {PAYMENT_LABEL_SHORT[order.paymentState]}
                  </Badge>
                  {order.dueAmount > 0 && (
                    <div className="tnum mt-0.5 text-[12px] text-warn">
                      үлдэгдэл {money(order.dueAmount)}
                    </div>
                  )}
                </Td>
                <Td>
                  <OrderBadge status={order.status} />
                </Td>
                {canOmit && (
                  <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busyKey === `omit:${order.id}`}
                      disabled={busyKey !== null}
                      onClick={() => omitOrder(order)}
                    >
                      Хасах
                    </Button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* --- Хассан захиалгууд --- */}
      {(batch.omittedOrders?.length ?? 0) > 0 && (
        <>
          <h2 className="mt-6 mb-1 text-[16px] font-medium">Хассан захиалгууд</h2>
          <p className="mt-0 mb-2 text-[13px] text-ink-2">
            Төлбөр ороогүй тул багцаас хассан. Мөнгө орвол (хоцорсон ч) дахин оруулж бэлдэнэ.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Код</Th>
                <Th>Харилцагч</Th>
                <Th className="text-right">Дүн</Th>
                <Th>Төлбөр</Th>
                <Th className="text-right" />
              </tr>
            </thead>
            <tbody>
              {batch.omittedOrders.map((order) => {
                const canReinstate = order.dueAmount <= 0 && batch.stage !== "DONE";
                return (
                  <tr
                    key={order.id}
                    onClick={() => onOpenOrder(order.id)}
                    className="cursor-pointer transition-colors hover:bg-surface"
                  >
                    <Td>
                      <span className="tnum text-[13px] underline underline-offset-2">
                        {order.code}
                      </span>
                    </Td>
                    <Td>
                      <div className="text-[14px]">{order.customer.name ?? "Нэргүй"}</div>
                      <div className="tnum text-[12px] text-muted">{order.customer.phone}</div>
                    </Td>
                    <Td className="text-right">
                      <span className="tnum">{money(order.subtotal)}</span>
                    </Td>
                    <Td onClick={(e) => e.stopPropagation()}>
                      <Badge tone={PAYMENT_TONE[order.paymentState]}>
                        {PAYMENT_LABEL_SHORT[order.paymentState]}
                      </Badge>
                      {order.dueAmount > 0 ? (
                        <div className="tnum mt-0.5 text-[12px] text-warn">
                          үлдэгдэл {money(order.dueAmount)}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[12px] text-ok">Төлбөр орсон — оруулж болно</div>
                      )}
                    </Td>
                    <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        disabled={!canReinstate || busyKey !== null}
                        loading={busyKey === `reinstate:${order.id}`}
                        onClick={() => reinstateOrder(order)}
                      >
                        Дахин оруулах
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}

function EditBatchForm({
  batch,
  onSaved,
}: {
  batch: AdminBatchDetail;
  onSaved: (updated: Partial<AdminBatchDetail>) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(batch.name);
  const [deadline, setDeadline] = useState(toDateInput(batch.deadline));
  const [etaFrom, setEtaFrom] = useState(toDateInput(batch.etaFrom));
  const [etaTo, setEtaTo] = useState(toDateInput(batch.etaTo));
  const [weightKg, setWeightKg] = useState(batch.weightKg?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await adminApi.updateBatch(batch.id, {
        name: name.trim(),
        deadline: deadline || null,
        etaFrom: etaFrom || null,
        etaTo: etaTo || null,
        weightKg: weightKg ? Number(weightKg) : null,
      });
      onSaved(updated);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хадгалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="mb-1.5 text-[13px] text-ink-2">Нэр</div>
          <Input value={name} onChange={setName} />
        </div>
        <div>
          <div className="mb-1.5 text-[13px] text-ink-2">Захиалга хаагдах</div>
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="h-11 w-full rounded-[8px] border border-line bg-bg px-3 text-[14px]"
          />
        </div>
        <div>
          <div className="mb-1.5 text-[13px] text-ink-2">Ирэх (эхлэх)</div>
          <input
            type="date"
            value={etaFrom}
            onChange={(e) => setEtaFrom(e.target.value)}
            className="h-11 w-full rounded-[8px] border border-line bg-bg px-3 text-[14px]"
          />
        </div>
        <div>
          <div className="mb-1.5 text-[13px] text-ink-2">Ирэх (дуусах)</div>
          <input
            type="date"
            value={etaTo}
            onChange={(e) => setEtaTo(e.target.value)}
            className="h-11 w-full rounded-[8px] border border-line bg-bg px-3 text-[14px]"
          />
        </div>
      </div>
      <div className="mt-3 flex items-end gap-3">
        <div>
          <div className="mb-1.5 text-[13px] text-ink-2">Жин (кг)</div>
          <Input value={weightKg} onChange={setWeightKg} placeholder="0" className="w-28" />
        </div>
        <Button onClick={save} loading={busy} disabled={!name.trim()}>
          Хадгалах
        </Button>
      </div>
      <p className="mt-2 mb-0 text-[12px] text-muted">
        Хаагдах огноог өөрчлөхөд багцын бүх урьдчилсан бараа болон захиалсан
        хүмүүсийн ирэх огноо дагаж шинэчлэгдэнэ.
      </p>
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Card>
  );
}

/** Хаагдсан гаргалтыг он/сараар сонгож багцад нэмэх. */
function ClosedRoundPicker({
  batch,
  onAdded,
}: {
  batch: AdminBatchDetail;
  onAdded: (products: BatchProduct[]) => void;
}) {
  const toast = useToast();
  const [months, setMonths] = useState<
    { year: number; month: number; key: string; count: number }[]
  >([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [rounds, setRounds] = useState<BatchProduct[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingMonths, setLoadingMonths] = useState(true);
  const [loadingRounds, setLoadingRounds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoadingMonths(true);
      try {
        const list = await adminApi.batchEligibleMonths();
        setMonths(list);
        if (list[0]) setSelectedKey(list[0].key);
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Сарууд ачаалж чадсангүй.");
      } finally {
        setLoadingMonths(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedKey) {
      setRounds([]);
      return;
    }
    const [y, m] = selectedKey.split("-").map(Number);
    void (async () => {
      setLoadingRounds(true);
      setSelected(new Set());
      try {
        const list = await adminApi.batchEligibleRounds(y!, m!);
        setRounds(list);
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Гаргалт ачаалж чадсангүй.");
      } finally {
        setLoadingRounds(false);
      }
    })();
  }, [selectedKey]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addSelected = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const result = await adminApi.addBatchProduct(batch.id, {
        roundIds: [...selected],
      });
      const list = Array.isArray(result) ? result : [result];
      onAdded(list);
      setSelected(new Set());
      setRounds((prev) => prev.filter((r) => !selected.has(r.roundId)));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Нэмж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  const inBatch = new Set(batch.products.map((p) => p.roundId));

  return (
    <Card className="mb-4 p-4">
      <div className="mb-2 text-[14px] font-medium">Хаагдсан гаргалт — он/сараар</div>
      <p className="mt-0 mb-3 text-[12px] text-muted">
        Захиалга хаагдсан сараар шүүж сонгоод багцад оруулна. Захиалгууд дагаж орно.
      </p>

      {loadingMonths ? (
        <div className="flex justify-center py-6">
          <Spinner className="text-muted" />
        </div>
      ) : months.length === 0 ? (
        <div className="py-4 text-center text-[13px] text-muted">
          Нэмэх боломжтой хаагдсан гаргалт алга.
        </div>
      ) : (
        <>
          <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
            {months.map((m) => {
              const active = m.key === selectedKey;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setSelectedKey(m.key)}
                  className={`h-9 shrink-0 cursor-pointer rounded-[8px] border px-3 text-[13px] ${
                    active
                      ? "border-ink bg-ink text-white"
                      : "border-line bg-bg text-ink hover:border-ink/40"
                  }`}
                >
                  {m.year} · {MONTH_LABELS[m.month - 1]}
                  <span className="tnum ml-1.5 opacity-70">{m.count}</span>
                </button>
              );
            })}
          </div>

          {error && (
            <div className="mb-3">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}

          {loadingRounds ? (
            <div className="flex justify-center py-8">
              <Spinner className="text-muted" />
            </div>
          ) : rounds.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-muted">
              Энэ сард нэмэх гаргалт алга.
            </div>
          ) : (
            <div className="max-h-[320px] overflow-y-auto">
              {rounds.map((row) => {
                const linked = inBatch.has(row.roundId);
                const checked = selected.has(row.roundId);
                return (
                  <label
                    key={row.roundId}
                    className={`flex cursor-pointer items-center gap-3 border-b border-line py-2 last:border-b-0 ${
                      linked ? "opacity-50" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={linked}
                      checked={linked || checked}
                      onChange={() => toggle(row.roundId)}
                      className="size-4"
                    />
                    <ProductImage
                      src={row.image}
                      alt={row.name}
                      className="h-10 w-10 shrink-0 rounded-[8px]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px]">{row.name}</div>
                      <div className="tnum text-[12px] text-muted">
                        #{row.roundNo}
                        {row.closeAt ? ` · ${dayLabel(row.closeAt)}` : ""}
                        {` · ${money(row.sellPrice)}`}
                        {row.orderedQty > 0
                          ? ` · ${row.orderedQty} ш · ${row.customerCount} хүн`
                          : ""}
                      </div>
                    </div>
                    {linked && (
                      <span className="text-[12px] text-muted">Багцад байна</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="tnum text-[13px] text-muted">{selected.size} сонгосон</span>
            <Button
              size="sm"
              onClick={() => void addSelected()}
              loading={busy}
              disabled={selected.size === 0}
            >
              Багцад нэмэх
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
