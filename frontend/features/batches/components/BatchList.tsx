"use client";

import { BATCH_STAGE_LABEL } from "@/components/admin/shared";
import { Badge } from "@/components/ui";
import { dayLabel, money, rangeLabel } from "@/lib/format";
import type { AdminBatch } from "@/lib/types";
import { StageBar } from "./StageBar";

export function BatchList({
  batches,
  onOpen,
}: {
  batches: AdminBatch[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {batches.map((batch) => (
        <button
          key={batch.id}
          type="button"
          onClick={() => onOpen(batch.id)}
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
  );
}
