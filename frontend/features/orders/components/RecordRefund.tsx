"use client";

import { useState } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { money } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";

export function RecordRefund({
  max,
  disabled,
  loading,
  onSubmit,
}: {
  max: number;
  disabled: boolean;
  loading: boolean;
  onSubmit: (body: { amount: number; method: PaymentMethod; note?: string }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(max));
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        Буцаалт хийх
      </Button>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="text-[15px] font-medium">Буцаалт</div>
      <p className="m-0 text-[13px] text-ink-2">
        Хамгийн ихдээ <span className="tnum">{money(max)}</span> буцаана.
      </p>
      <Field label="Дүн">
        <Input
          value={amount}
          onChange={(v) => setAmount(v.replace(/\D/g, ""))}
          inputMode="numeric"
        />
      </Field>
      <Field label="Шалтгаан" hint="Заавал биш">
        <Input value={note} onChange={setNote} />
      </Field>
      <div className="flex gap-2">
        <Button
          variant="danger"
          disabled={disabled || !amount || Number(amount) <= 0 || Number(amount) > max}
          loading={loading}
          onClick={() =>
            onSubmit({
              amount: Number(amount),
              method: "BANK_TRANSFER",
              note: note.trim() || undefined,
            })
          }
        >
          Буцаах
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Болих
        </Button>
      </div>
    </Card>
  );
}
