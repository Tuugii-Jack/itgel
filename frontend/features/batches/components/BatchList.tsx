"use client";

import { BATCH_STAGE_LABEL } from "@/components/admin/shared";
import { Badge } from "@/components/ui";
import { dayLabel, rangeLabel } from "@/lib/format";
import type { AdminBatch, BatchProgress } from "@/lib/types";
import { StageBar } from "./StageBar";

const PROGRESS_TONE: Record<BatchProgress, "info" | "warn" | "ok" | "danger"> = {
  in_transit: "info",
  partial: "warn",
  complete: "ok",
  mismatch: "danger",
};

export function BatchList({
  batches,
  onOpen,
}: {
  batches: AdminBatch[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {batches.map((batch) => {
        const unlinked = batch.unlinkedQty ?? 0;
        const linked = batch.linkedQty ?? 0;
        const remaining = batch.remainingQty ?? Math.max(0, linked - (batch.arrivedQty ?? 0));
        return (
          <button
            key={batch.id}
            type="button"
            onClick={() => onOpen(batch.id)}
            className="cursor-pointer rounded-[12px] border border-line bg-bg p-4 text-left transition-colors hover:border-ink/30"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[15px] font-medium">{batch.name}</div>
                <div className="mt-0.5 text-[13px] text-muted">
                  {batch.cargoRef ? `${batch.cargoRef} · ` : ""}
                  {batch.orderCount} захиалга
                  {batch.orderedQty != null ? ` · ${batch.orderedQty} ш захиалсан` : ""}
                  {batch.linkedQty != null ? ` · ${batch.linkedQty} ш холбосон` : ""}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {batch.progress && (
                  <Badge tone={PROGRESS_TONE[batch.progress]}>
                    {batch.progressLabel ?? batch.progress}
                  </Badge>
                )}
                <Badge tone={batch.stage === "DONE" ? "ok" : "info"}>
                  {BATCH_STAGE_LABEL[batch.stage]}
                </Badge>
              </div>
            </div>

            <StageBar stage={batch.stage} />

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-2">
              <span className="tnum">Үүссэн: {dayLabel(batch.createdAt)}</span>
              {batch.etaFrom && batch.etaTo && (
                <span className="tnum">Ирэх: {rangeLabel(batch.etaFrom, batch.etaTo)}</span>
              )}
              {unlinked > 0 && (
                <span className="tnum text-warn">Холбоос дутуу {unlinked} ш</span>
              )}
              {linked > 0 && (
                <span className="tnum">
                  Ирсэн {batch.arrivedQty ?? 0} / үлдсэн {remaining}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
