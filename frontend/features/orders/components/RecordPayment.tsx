"use client";

import { useState } from "react";
import { Select } from "@/components/admin/shared";
import { Button, Card, Field, Input } from "@/components/ui";
import type { PaymentMethod } from "@/lib/types";

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

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="text-[15px] font-medium">Төлбөр бүртгэх</div>
      <p className="m-0 text-[13px] text-ink-2">
        Данс шалгаад мөнгө орсныг энд бичнэ. Захиалга үүнээс өмнө баталгаажихгүй.
      </p>
      <Field label="Дүн">
        <Input
          value={amount}
          onChange={(v) => setAmount(v.replace(/\D/g, ""))}
          inputMode="numeric"
        />
      </Field>
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
        disabled={disabled || !amount || Number(amount) <= 0}
        loading={loading}
        onClick={() =>
          onSubmit({
            amount: Number(amount),
            method,
            reference: reference.trim() || undefined,
          })
        }
      >
        Бүртгэх
      </Button>
    </Card>
  );
}
