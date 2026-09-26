"use client";

import { useCallback } from "react";
import { OrderDetail } from "@/components/admin/OrderDetail";
import { Metric, PageHead } from "@/components/admin/shared";
import { Button, Empty, ErrorNote, Input, Skeleton } from "@/components/ui";
import { useToast } from "@/lib/toast";
import { useDeferredReload } from "@/lib/useDeferredReload";
import type { BatchProgress } from "@/lib/types";
import { useBatches } from "../hooks/useBatches";
import { BatchDetail } from "./BatchDetail";
import { BatchList } from "./BatchList";
import { CreateBatchForm } from "./CreateBatchForm";

const PROGRESS_METRICS: {
  key: BatchProgress;
  label: string;
  tone: "info" | "warn" | "ok" | "danger";
}[] = [
  { key: "in_transit", label: "Замд яваа", tone: "info" },
  { key: "partial", label: "Хэсэгчлэн ирсэн", tone: "warn" },
  { key: "complete", label: "Бүрэн ирсэн", tone: "ok" },
  { key: "mismatch", label: "Зөрүүтэй", tone: "danger" },
];

export function BatchesPage() {
  const toast = useToast();
  const {
    batches,
    setBatches,
    summary,
    pageMeta,
    loading,
    error,
    search,
    setSearch,
    progress,
    toggleProgress,
    from,
    setFrom,
    to,
    setTo,
    page,
    setPage,
    openBatchId,
    setOpenBatchId,
    openOrderId,
    setOpenOrderId,
    creating,
    setCreating,
    load,
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
        hint="Ирсэн хаагдсан барааг он/сараар сонгож багцад хийнэ. «Ачаа хүлээн авах»-аар энэ удаа ирсэн тоог бүртгэнэ — түрүүлж захиалсан хүмүүст эхлээд хуваарилагдана."
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

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {PROGRESS_METRICS.map((item) => (
          <Metric
            key={item.key}
            label={item.label}
            value={summary[item.key]}
            tone={item.tone}
            active={progress === item.key}
            onClick={() => toggleProgress(item.key)}
          />
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1">
          <Input
            value={search}
            onChange={setSearch}
            placeholder="Багц, захиалгын код, барааны нэр"
            aria-label="Хайх"
          />
        </div>
        <label className="text-[13px] text-ink-2">
          Эхлэх
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block h-11 rounded-[8px] border border-line bg-bg px-3 text-[14px]"
          />
        </label>
        <label className="text-[13px] text-ink-2">
          Дуусах
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block h-11 rounded-[8px] border border-line bg-bg px-3 text-[14px]"
          />
        </label>
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
        <Empty>
          {search || progress || from || to
            ? "Шүүлтэд тохирох багц алга."
            : "Багц алга байна. «Багц үүсгэх» товчоор эхлүүлээрэй."}
        </Empty>
      ) : (
        <>
          <BatchList batches={batches} onOpen={setOpenBatchId} />
          {pageMeta.pages > 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13px] text-muted">
                {pageMeta.total} багц · {pageMeta.page}/{pageMeta.pages} хуудас
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Өмнөх
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= pageMeta.pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Дараах
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
