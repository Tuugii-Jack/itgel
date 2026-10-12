"use client";

import { useRef, useState } from "react";
import { Select } from "@/components/admin/shared";
import { Button, Card, Field, Input } from "@/components/ui";
import type { PaymentMethod } from "@/lib/types";
import { money } from "@/lib/format";
import { parseMoneyInput } from "@/lib/moneyInput";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "BANK_TRANSFER", label: "Шилжүүлэг" },
  { value: "QPAY", label: "QPay" },
  { value: "CASH", label: "Бэлэн" },
  { value: "CARD", label: "Карт" },
  { value: "OTHER", label: "Бусад" },
];

export function RecordPayment({
  suggested,
  disabled,
  loading,
  onSubmit,
}: {
  suggested: number;
  disabled: boolean;
  loading: boolean;
  onSubmit: (body: {
    amount: number;
    method: PaymentMethod;
    reference?: string;
  }) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(suggested));
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const submitting = useRef(false);
  const parsed = parseMoneyInput(amount);
  const submit = async () => {
    if (submitting.current || disabled || loading || parsed === null) return;
    submitting.current = true;
    try { await onSubmit({ amount: parsed, method, reference: reference.trim() || undefined }); }
    finally { submitting.current = false; }
  };

  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}><Card className="flex flex-col gap-3 p-4">
      <div className="text-[15px] font-medium">Төлбөр бүртгэх</div>
      <p className="m-0 text-[13px] text-ink-2">
        Дансанд мөнгө орсныг шалгаад, төлсөн дүн болон аргыг бүртгэнэ.
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
        <span className={parsed === null && amount ? "text-danger" : "text-ink-2"}>{parsed !== null ? money(parsed) : amount ? "Дүнг бүхэл төгрөгөөр оруулна уу." : "Төлсөн дүнг оруулна уу."}</span>
        {suggested > 0 && <button type="button" disabled={disabled || loading} onClick={() => setAmount(String(suggested))} className="text-secondary underline">Санал болгосон дүн</button>}
      </div>
      <Field label="Арга">
        <Select
          value={method}
          onChange={(v) => setMethod(v as PaymentMethod)}
          options={METHODS}
          className="w-full"
        />
      </Field>
      <Field label="Гүйлгээний утга" hint="Заавал биш">
        <Input value={reference} onChange={setReference} placeholder="Жишээ: TXN-4821" />
      </Field>
      <Button
        full
        type="submit"
        disabled={disabled || parsed === null}
        loading={loading}
      >
        {parsed !== null ? `${money(parsed)} бүртгэх` : "Төлбөр бүртгэх"}
      </Button>
    </Card></form>
  );
}
