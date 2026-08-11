"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { useToast } from "@/lib/toast";
import { dayLabel, money, rangeLabel } from "@/lib/format";
import type {
  AdminBatch,
  AdminBatchDetail,
  AdminProduct,
  BatchStage,
} from "@/lib/types";

const STAGES: BatchStage[] = [
  "COLLECTING",
  "CLOSED",
  "AT_SUPPLIER",
  "IN_TRANSIT",
  "AT_WAREHOUSE",
  "DONE",
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
        hint="Багц үүсгэж бараагаа нэмээрэй — тэдгээрийн захиалга баталгаажихдаа багцад автоматаар орно."
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
            toast.success("Багц үүслээ. Одоо бараагаа нэмээрэй.");
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
          className={`h-1 flex-1 rounded-full ${i <= index ? "bg-ink" : "bg-line"}`}
        />
      ))}
    </div>
  );
}

function CreateBatchForm({ onCreated }: { onCreated: (batch: AdminBatch) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const batch = await adminApi.createBatch({
        name: name.trim(),
        deadline: deadline || null,
      });
      onCreated({ ...batch, orderCount: 0, totalValue: 0, nextStage: "CLOSED", createdAt: new Date().toISOString() });
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
          <Input value={name} onChange={setName} placeholder="Жишээ: 9-р сарын ачаа" />
        </div>
        <div>
          <div className="mb-1.5 text-[13px] text-ink-2">Захиалга хаагдах огноо</div>
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="h-11 w-full rounded-[8px] border border-line bg-bg px-3 text-[14px] sm:w-auto"
          />
        </div>
        <Button onClick={create} loading={busy} disabled={!name.trim()}>
          Үүсгэх
        </Button>
      </div>
      <p className="mt-2 mb-0 text-[12px] text-muted">
        Багцад нэмсэн бараанууд энэ огноог хүртэл захиалга авна. Огноог дараа нь өөрчилж болно.
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

  const collecting = batch.stage === "COLLECTING";

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
            const index = STAGES.indexOf(batch.stage);
            const passed = i < index;
            const current = i === index;
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

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Бараа" value={batch.products.length} />
        <Metric label="Захиалга" value={batch.orders.length} />
        <Metric label="Нийт дүн" value={money(batch.totalValue)} />
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
        {collecting && (
          <Button size="sm" onClick={() => setPicking((v) => !v)}>
            {picking ? "Болих" : "Бараа нэмэх"}
          </Button>
        )}
      </div>

      {picking && (
        <ProductPicker
          batch={batch}
          onAdded={(product) => {
            setBatch((prev) =>
              prev ? { ...prev, products: [...prev.products, product] } : prev,
            );
            toast.success(`«${product.name}» багцад нэмэгдлээ.`);
          }}
        />
      )}

      {batch.products.length === 0 ? (
        <Empty>
          {collecting
            ? "Бараа нэмээгүй байна. «Бараа нэмэх» товчоор каталогоос сонгоорой."
            : "Энэ багцад бараа холбогдоогүй."}
        </Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Бараа</Th>
              <Th className="text-right">Зарах үнэ</Th>
              <Th>Хаагдах</Th>
              <Th className="text-right">Захиалга</Th>
              <Th>Төлөв</Th>
              {collecting && <Th />}
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
                {collecting && (
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeProduct(p.roundId, p.name)}
                      loading={busyKey === `remove:${p.roundId}`}
                      disabled={p.orderedQty > 0}
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

      {/* --- Багцын захиалгууд --- */}
      <h2 className="mt-6 mb-2 text-[16px] font-medium">Захиалгууд</h2>
      {batch.orders.length === 0 ? (
        <Empty>Захиалга алга. Барааны захиалгууд баталгаажихдаа энд орж ирнэ.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Код</Th>
              <Th>Харилцагч</Th>
              <Th className="text-right">Дүн</Th>
              <Th>Төлөв</Th>
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
                <Td>
                  <OrderBadge status={order.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
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

/** Каталогоос бараа хайж багцад нэмэх / одоогийн гаргалт холбох. */
function ProductPicker({
  batch,
  onAdded,
}: {
  batch: AdminBatchDetail;
  onAdded: (product: AdminBatchDetail["products"][number]) => void;
}) {
  const [mode, setMode] = useState<"create" | "link">("link");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchProducts = useCallback(
    async (q: string) => {
      setLoading(true);
      try {
        const res = await adminApi.products({
          type: mode === "link" ? "order" : undefined,
          q: q.trim() || undefined,
          pageSize: 30,
        });
        setResults(res.data);
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Хайлт амжилтгүй.");
      } finally {
        setLoading(false);
      }
    },
    [mode],
  );

  useEffect(() => {
    void fetchProducts("");
  }, [fetchProducts]);

  const onSearch = (value: string) => {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void fetchProducts(value), 350);
  };

  const addNew = async (product: AdminProduct) => {
    setAddingId(product.id);
    try {
      const added = await adminApi.addBatchProduct(batch.id, { productId: product.id });
      onAdded(added);
      toast.success(`«${product.name}» шинэ гаргалттай нэмэгдлээ.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Нэмж чадсангүй.");
    } finally {
      setAddingId(null);
    }
  };

  const linkRound = async (product: AdminProduct, roundId: string, label: string) => {
    setAddingId(roundId);
    try {
      const added = await adminApi.addBatchProduct(batch.id, { roundId });
      onAdded(added);
      toast.success(`«${label}» холбогдлоо — захиалгууд багцад орлоо.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Холбож чадсангүй.");
    } finally {
      setAddingId(null);
    }
  };

  const inBatch = new Set(batch.products.map((p) => p.productId));
  const inBatchRounds = new Set(batch.products.map((p) => p.roundId));

  type LinkRow = {
    key: string;
    product: AdminProduct;
    roundId: string;
    roundNo: number;
    sellPrice: number;
    orderedQty: number;
  };

  const linkRows: LinkRow[] = [];
  if (mode === "link") {
    for (const product of results) {
      for (const round of product.rounds) {
        if (round.closeAt == null) continue;
        if (round.batchId) continue;
        if (round.status === "ARCHIVED") continue;
        linkRows.push({
          key: round.id,
          product,
          roundId: round.id,
          roundNo: round.roundNo,
          sellPrice: round.sellPrice,
          orderedQty: round.orderedQty,
        });
      }
    }
  }

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={mode === "link" ? "primary" : "outline"}
          onClick={() => setMode("link")}
        >
          Одоогийн гаргалт холбох
        </Button>
        <Button
          size="sm"
          variant={mode === "create" ? "primary" : "outline"}
          onClick={() => setMode("create")}
        >
          Шинэ гаргалт үүсгэх
        </Button>
      </div>
      <Input value={search} onChange={onSearch} placeholder="Каталогоос бараа хайх…" />
      <p className="mt-2 mb-0 text-[12px] text-muted">
        {mode === "link"
          ? "Урьдчилсан захиалгын цэсээр үүсгэсэн, багцгүй гаргалтыг холбоно. Захиалсан хүмүүс багцад дагана."
          : "Сонгосон бараа энэ багцын хаагдах огноогоор шинэ гаргалт болно."}
      </p>
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="mt-3 max-h-[320px] overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner className="text-muted" />
          </div>
        ) : mode === "link" ? (
          linkRows.length === 0 ? (
            <div className="py-6 text-center text-[13px] text-muted">
              Холбох боломжтой урьдчилсан гаргалт алга.
            </div>
          ) : (
            <div className="flex flex-col">
              {linkRows.map((row) => {
                const linked = inBatchRounds.has(row.roundId);
                return (
                  <div
                    key={row.key}
                    className="flex items-center gap-3 border-b border-line py-2 last:border-b-0"
                  >
                    <ProductImage
                      src={row.product.images[0] ?? null}
                      alt={row.product.name}
                      className="h-10 w-10 shrink-0 rounded-[8px]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px]">{row.product.name}</div>
                      <div className="tnum text-[12px] text-muted">
                        #{row.roundNo} · {money(row.sellPrice)}
                        {row.orderedQty > 0 ? ` · ${row.orderedQty} захиалга` : ""}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={linked ? "outline" : "primary"}
                      disabled={linked}
                      loading={addingId === row.roundId}
                      onClick={() =>
                        linkRound(row.product, row.roundId, `${row.product.name} #${row.roundNo}`)
                      }
                    >
                      {linked ? "Холбогдсон" : "Холбох"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )
        ) : results.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-muted">Бараа олдсонгүй.</div>
        ) : (
          <div className="flex flex-col">
            {results.map((product) => {
              const added = inBatch.has(product.id);
              const lastRound = product.rounds[0] ?? null;
              return (
                <div
                  key={product.id}
                  className="flex items-center gap-3 border-b border-line py-2 last:border-b-0"
                >
                  <ProductImage
                    src={product.images[0] ?? null}
                    alt={product.name}
                    className="h-10 w-10 shrink-0 rounded-[8px]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px]">{product.name}</div>
                    <div className="text-[12px] text-muted">
                      {product.category?.name ?? ""}
                      {lastRound
                        ? ` · сүүлд ${money(lastRound.sellPrice)}`
                        : " · үнэгүй тул нэмэхэд үнэ асуух болно"}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={added ? "outline" : "primary"}
                    disabled={added}
                    loading={addingId === product.id}
                    onClick={() => addNew(product)}
                  >
                    {added ? "Нэмэгдсэн" : "Нэмэх"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
