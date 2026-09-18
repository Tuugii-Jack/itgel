"use client";

import { Button } from "@/components/ui";

export function PollRetryNote({
  onCheck,
}: {
  onCheck: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-line bg-surface px-3 py-2.5">
      <p className="m-0 text-[13px] leading-[1.5] text-ink-2">
        Автомат шалгалтын хугацаа дууссан. Төлбөр орсон бол доор шалгана уу. Шаардлагатай бол дахин оролдоно.
      </p>
      <Button size="sm" variant="outline" onClick={onCheck}>
        Төлбөр шалгах
      </Button>
    </div>
  );
}
