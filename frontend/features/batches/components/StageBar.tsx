import { BATCH_STAGE_LABEL } from "@/components/admin/shared";
import type { BatchStage } from "@/lib/types";

export const STAGES: BatchStage[] = ["IN_TRANSIT", "AT_WAREHOUSE", "DONE"];

export function StageBar({ stage }: { stage: BatchStage }) {
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
