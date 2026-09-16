"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";

export function CancelItem({
  disabled,
  loading,
  onCancel,
}: {
  disabled: boolean;
  loading: boolean;
  onCancel: (reason: string | undefined, refund: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-danger underline disabled:opacity-40"
      >
        Цуцлах
      </button>
    );
  }

  return (
    <div className="flex w-[220px] flex-col gap-2 rounded-[8px] border border-line p-2">
      <Input value={reason} onChange={setReason} placeholder="Шалтгаан" />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={disabled}
          loading={loading}
          onClick={() => onCancel(reason.trim() || undefined, true)}
        >
          Цуцлаад буцаах
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Болих
        </Button>
      </div>
    </div>
  );
}
