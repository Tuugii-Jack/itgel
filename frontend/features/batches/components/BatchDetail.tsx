"use client";

import { useState } from "react";
import { ProductImage } from "@/components/ProductImage";
import { ArrivalRegister } from "@/components/admin/ArrivalRegister";
import { CargoFeeEditor } from "@/components/admin/CargoFeeEditor";
import {
  BATCH_STAGE_LABEL,
  Metric,
  ProductStatusBadge,
  Table,
  Td,
  Th,
} from "@/components/admin/shared";
import { Badge, Button, Card, Empty, ErrorNote, Skeleton } from "@/components/ui";
import { useToast } from "@/lib/toast";
import { dayLabel, rangeLabel } from "@/lib/format";
import type { BatchProgress } from "@/lib/types";
import { useBatchDetail } from "../hooks/useBatchDetail";
import { ClosedRoundPicker } from "./ClosedRoundPicker";
import { EditBatchForm } from "./EditBatchForm";
import { BatchHistoryPanel } from "./BatchHistoryPanel";
import { BatchOrdersPanel } from "./BatchOrdersPanel";
import { STAGES } from "./StageBar";

const TABS = [
  { id: "products", label: "Бараа" },
  { id: "orders", label: "Холбогдох захиалга" },
  { id: "history", label: "Үйлдлийн түүх" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const PROGRESS_TONE: Record<BatchProgress, "info" | "warn" | "ok" | "danger"> = {
  in_transit: "info",
  partial: "warn",
  complete: "ok",
  mismatch: "danger",
};

/** Нэг багцын дэлгэрэнгүй — бараа, захиалга, шат бүгд нэг дор. */
export function BatchDetail({
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
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<TabId>("products");
  const {
    batch,
    setBatch,
    loading,
    error,
    busyKey,
    load,
    loadOrders,
    advance,
    revert,
    removeProduct,
    omitOrder,
    reinstateOrder,
  } = useBatchDetail(batchId, onListChanged);

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
          {batch.progress && (
            <Badge tone={PROGRESS_TONE[batch.progress]}>
              {batch.progressLabel ?? batch.progress}
            </Badge>
          )}
          <Badge tone={batch.stage === "DONE" ? "ok" : "info"}>
            {BATCH_STAGE_LABEL[batch.stage]}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-2">
          {batch.cargoRef && <span>Карго: {batch.cargoRef}</span>}
          <span className="tnum">Үүссэн: {dayLabel(batch.createdAt)}</span>
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

      {(batch.unlinkedQty ?? 0) > 0 && (
        <div className="mb-4">
          <ErrorNote>
            Холбоос дутуу: {batch.unlinkedQty} ш захиалсан барааны тойрог энэ багцад холбогдоогүй.
            Ирсэн/дутууг 0 эсвэл бүрэн гэж тооцохгүй. Таамгаар тойрог холбохгүй. Ирэлт бүртгэхийн
            өмнө «Бараа нэмэх»-ээр тойрог сонгоно.
          </ErrorNote>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Захиалсан ширхэг" value={`${batch.orderedQty ?? 0} ш`} />
        <Metric label="Багцад холбосон" value={`${batch.linkedQty ?? 0} ш`} />
        <Metric label="Ирсэн" value={`${batch.arrivedQty ?? 0} ш`} />
        {(batch.unlinkedQty ?? 0) > 0 ? (
          <Metric label="Холбоос дутуу" value={`${batch.unlinkedQty} ш`} tone="warn" />
        ) : (
          <Metric
            label="Үлдсэн"
            value={`${batch.remainingQty ?? 0} ш`}
            tone={(batch.remainingQty ?? 0) > 0 ? "warn" : "ok"}
          />
        )}
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              if (item.id === "orders") void loadOrders();
            }}
            className={`h-11 shrink-0 px-3 text-[14px] ${
              tab === item.id
                ? "border-b-2 border-ink font-medium text-ink"
                : "cursor-pointer text-ink-2"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "products" && (
        <>
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
              {(batch.unlinkedQty ?? 0) > 0
                ? "Захиалгатай боловч тойрог холбогдоогүй. Холбоос дутуу тул ирэлт бүртгэхгүй."
                : editable
                  ? "Бараа нэмээгүй байна. «Бараа нэмэх» товчоор хаагдсан гаргалтыг сараар сонгоорой."
                  : "Энэ багцад бараа холбогдоогүй."}
            </Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Бараа</Th>
                  <Th className="text-right">Хүлээгдэж буй</Th>
                  <Th className="text-right">Ирсэн</Th>
                  <Th className="text-right">Дутуу</Th>
                  <Th>Төлөв</Th>
                  {editable && <Th />}
                </tr>
              </thead>
              <tbody>
                {batch.products.map((p) => {
                  const arrived = (p.variants ?? []).reduce((s, v) => s + v.arrivedQty, 0);
                  const remaining = (p.variants ?? []).reduce((s, v) => s + v.remainingQty, 0);
                  return (
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
                        <span className="tnum">{p.orderedQty} ш</span>
                      </Td>
                      <Td className="text-right">
                        <span className="tnum">{arrived} ш</span>
                      </Td>
                      <Td className="text-right">
                        <span className={`tnum ${remaining > 0 ? "text-warn" : "text-ok"}`}>
                          {remaining} ш
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
                  );
                })}
              </tbody>
            </Table>
          )}

          <div className="mt-4">
            <ArrivalRegister
              batch={batch}
              onSaved={() => {
                void load(true);
                onListChanged();
              }}
            />
          </div>

          <CargoFeeEditor
            batch={batch}
            onSaved={async () => {
              await load(true);
              onListChanged();
            }}
          />
        </>
      )}

      {tab === "orders" && (
        <BatchOrdersPanel
          batch={batch}
          busyKey={busyKey}
          onOpenOrder={onOpenOrder}
          onOmit={omitOrder}
          onReinstate={reinstateOrder}
          onSmsSent={() => void load(true, { withOrders: true })}
        />
      )}

      {tab === "history" && <BatchHistoryPanel batch={batch} />}
    </div>
  );
}
