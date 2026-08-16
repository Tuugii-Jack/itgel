"use client";

import { Field, Input } from "@/components/ui";
import { bankSelectOptions } from "@/lib/banks";

export function BankAccountFields({
  bankName,
  accountNumber,
  accountName,
  onBankName,
  onAccountNumber,
  onAccountName,
  disabled,
}: {
  bankName: string;
  accountNumber: string;
  accountName: string;
  onBankName: (value: string) => void;
  onAccountNumber: (value: string) => void;
  onAccountName: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
      <Field label="Банк">
        <select
          value={bankName}
          disabled={disabled}
          onChange={(e) => onBankName(e.target.value)}
          className="h-11 w-full rounded-[8px] border border-line bg-bg px-3 text-[15px] disabled:text-muted"
        >
          <option value="">Банк сонгох</option>
          {bankSelectOptions(bankName).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Дансны дугаар">
        <Input
          value={accountNumber}
          onChange={(v) => onAccountNumber(v.replace(/\D/g, "").slice(0, 20))}
          inputMode="numeric"
          placeholder="Дансны дугаар"
          disabled={disabled}
        />
      </Field>
      <div className="lg:col-span-2">
        <Field label="Дансны нэр">
          <Input
            value={accountName}
            onChange={onAccountName}
            placeholder="Жишээ: Б. Бат-Эрдэнэ"
            disabled={disabled}
          />
        </Field>
      </div>
    </div>
  );
}
