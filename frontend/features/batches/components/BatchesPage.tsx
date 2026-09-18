"use client";

import { useCallback } from "react";
import { OrderDetail } from "@/components/admin/OrderDetail";
import { Metric, PageHead } from "@/components/admin/shared";
import { Button, Empty, ErrorNote, Skeleton } from "@/components/ui";
import { money } from "@/lib/format";
import { useToast } from "@/lib/toast";
import { useDeferredReload } from "@/lib/useDeferredReload";
import { useBatches } from "../hooks/useBatches";
import { BatchDetail } from "./BatchDetail";
import { BatchList } from "./BatchList";
import { CreateBatchForm } from "./CreateBatchForm";

export function BatchesPage() {
  const toast = useToast();
  const {
    batches,
    setBatches,
    loading,
    error,
    openBatchId,
    setOpenBatchId,
    openOrderId,
    setOpenOrderId,
    creating,
    setCreating,
    load,
    active,
  } = useBatches();
  const reloadList = useCallback(() => load(true), [load]);
  const markChanged = useDeferredReload(reloadList, !openOrderId && !openBatchId);

  if (openOrderId) {
    return (
      <OrderDetail
        orderId={openOrderId}
        workspace="shop"
        onClose={() => setOpenOrderId(null)}
        onChanged={markChanged}
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
        hint="Ирсэн хаагдсан барааг он/сараар сонгож багцад хийнэ. Зам дээр байхад өнгө/хэмжээ бүрийн ирсэн тоог оруулна — түрүүлж захиалсан хүмүүст эхлээд хуваарилагдана."
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
        <BatchList batches={batches} onOpen={setOpenBatchId} />
      )}
    </div>
  );
}
