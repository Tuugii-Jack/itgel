"use client";

import { useRef, useState } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { money } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";
import { parseMoneyInput } from "@/lib/moneyInput";

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
  const submitting = useRef(false);
  const parsed = parseMoneyInput(amount, max);
  const submit = async () => {
    if (submitting.current || disabled || loading || parsed === null) return;
    submitting.current = true;
    try { await onSubmit({ amount: parsed, method: "BANK_TRANSFER", note: note.trim() || undefined }); }
    finally { submitting.current = false; }
  };

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        Буцаалт хийх
      </Button>
    );
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}><Card className="flex flex-col gap-3 p-4">
      <div className="text-[15px] font-medium">Буцаалт</div>
      <p className="m-0 text-[13px] text-ink-2">
        Хамгийн ихдээ <span className="tnum">{money(max)}</span> буцаана.
      </p>
      <Field label="Дүн">
        <Input
          value={amount}
          onChange={setAmount}
          inputMode="numeric"
          aria-invalid={parsed === null && amount.length > 0}
        />
      </Field>
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className={parsed === null && amount ? "text-danger" : "text-ink-2"}>{parsed !== null ? money(parsed) : "Бүхэл төгрөгөөр, боломжит дүнгээс хэтрүүлэхгүй оруулна уу."}</span>
        <button type="button" disabled={disabled || loading} onClick={() => setAmount(String(max))} className="shrink-0 text-secondary underline">Дээд дүн</button>
      </div>
      <Field label="Шалтгаан" hint="Заавал биш">
        <Input value={note} onChange={setNote} />
      </Field>
      <div className="flex gap-2">
        <Button
          variant="danger"
          type="submit"
          disabled={disabled || parsed === null}
          loading={loading}
        >
          {parsed !== null ? `${money(parsed)} буцаах` : "Буцаах"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Болих
        </Button>
      </div>
    </Card></form>
  );
}
