"use client";

import { useState } from "react";
import { ProductImage } from "@/components/ProductImage";
import { ArrivalRegister } from "@/components/admin/ArrivalRegister";
import { CargoFeeEditor } from "@/components/admin/CargoFeeEditor";
import {
  BATCH_STAGE_LABEL,
  Metric,
  OrderBadge,
  ProductStatusBadge,
  Table,
  Td,
  Th,
} from "@/components/admin/shared";
import { Badge, Button, Card, Empty, ErrorNote, Skeleton } from "@/components/ui";
import { PAYMENT_LABEL_SHORT, PAYMENT_TONE } from "@/lib/payment";
import { useToast } from "@/lib/toast";
import { dayLabel, money, rangeLabel } from "@/lib/format";
import { useBatchDetail } from "../hooks/useBatchDetail";
import { ArrivalSmsPanel } from "./ArrivalSmsPanel";
import { ClosedRoundPicker } from "./ClosedRoundPicker";
import { EditBatchForm } from "./EditBatchForm";
import { STAGES } from "./StageBar";

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
  const {
    batch,
    setBatch,
    loading,
    error,
    busyKey,
    load,
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
  const canOmit = editable;
  const unpaidCount = batch.orders.filter(
    (o) => (o.paidAmount ?? 0) < o.subtotal,
  ).length;

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

      <div className="mt-4">
        <ArrivalRegister batch={batch} onSaved={() => load(true)} />
      </div>

      <CargoFeeEditor
        batch={batch}
        onSaved={async () => {
          await load(true);
          onListChanged();
        }}
      />

      {(batch.stage === "AT_WAREHOUSE" || batch.stage === "DONE") && (
        <ArrivalSmsPanel batch={batch} onSent={() => load(true)} />
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
