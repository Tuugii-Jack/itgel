"use client";

import { useRef, useState } from "react";
import { Landmark, Check } from "lucide-react";
import { Select } from "@/components/admin/shared";
import { Button, Card, Field, Input } from "@/components/ui";
import { money } from "@/lib/format";
import { parseMoneyInput } from "@/lib/moneyInput";

export function RecordPayment({ orderCode, recipients, disabled, loading, onSubmit }: {
  orderCode: string;
  recipients: { payeeKind: 'SHOP' | 'LEASING'; label: string; dueAmount: number }[];
  disabled: boolean; loading: boolean;
  onSubmit: (body: { amount: number; method: 'BANK_TRANSFER'; reference: string; payeeKind: 'SHOP' | 'LEASING' }) => Promise<void>;
}) {
  const first = recipients.find((row) => row.dueAmount > 0) ?? recipients[0];
  const [payee, setPayee] = useState<'SHOP' | 'LEASING'>(first?.payeeKind ?? 'SHOP');
  const [amount, setAmount] = useState(String(first?.dueAmount ?? ''));
  const [reference, setReference] = useState('');
  const [review, setReview] = useState(false);
  const submitting = useRef(false);
  const recipient = recipients.find((row) => row.payeeKind === payee);
  const parsed = parseMoneyInput(amount, recipient?.dueAmount ?? 0);
  const valid = parsed !== null && reference.trim().length > 0 && reference.trim().length <= 120;
  const submit = async () => {
    if (submitting.current || disabled || loading || !valid || parsed === null) return;
    submitting.current = true;
    try { await onSubmit({ amount: parsed, method: 'BANK_TRANSFER', reference: reference.trim(), payeeKind: payee }); setReview(false); }
    finally { submitting.current = false; }
  };
  return <Card className="overflow-hidden border-secondary-muted">
    <div className="flex items-center gap-3 border-b border-secondary-muted bg-secondary-soft px-5 py-4">
      <Landmark className="h-5 w-5 text-secondary" aria-hidden="true" />
      <div><div className="text-[15px] font-medium">Дансаар орсон төлбөр</div><div className="mt-0.5 text-[12px] text-ink-2">Зөвхөн үндсэн админ бүртгэнэ</div></div>
    </div>
    <form className="p-5" onSubmit={(event) => { event.preventDefault(); if (review) void submit(); else if (valid) setReview(true); }}>
      <fieldset disabled={disabled || loading} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        {review ? <>
          <div className="rounded-xl border border-line bg-surface p-4 text-[13px]">
            <div className="mb-3 font-medium">Бүртгэхээс өмнө тулган шалгах</div>
            <div className="flex justify-between gap-3"><span className="text-muted">Захиалга</span><strong className="tnum">{orderCode}</strong></div>
            <div className="mt-2 text-ink-2">{recipient?.label}</div>
            <div className="my-3 tnum text-[24px] font-medium text-ink">{parsed !== null ? money(parsed) : '—'}</div>
            <div className="break-all text-muted">Гүйлгээ: {reference}</div>
          </div>
          <p className="m-0 text-[12px] leading-relaxed text-ink-2">Дансанд мөнгө орсныг шалгасан бол бүртгэнэ. QPay-ээр орсон мөнгийг энд давхар нэмэхгүй.</p>
          <Button full type="submit" disabled={!valid} loading={loading}><Check className="mr-2 h-4 w-4" aria-hidden="true" />Дансанд орсныг шалгасан — бүртгэх</Button>
          <Button variant="ghost" full onClick={() => setReview(false)}>Буцаж засах</Button>
        </> : <>
          {recipients.length > 1 ? <Field label="Мөнгө орсон хүлээн авагч"><Select value={payee} onChange={(value) => { const next = recipients.find((row) => row.payeeKind === value); if (next) { setPayee(next.payeeKind); setAmount(String(next.dueAmount)); } }} options={recipients.map((row) => ({ value: row.payeeKind, label: row.label }))} className="w-full" /></Field> : <div className="text-[13px] text-ink-2">{recipient?.label}</div>}
          <Field label="Орсон дүн" hint={`Үлдэгдэл ${money(recipient?.dueAmount ?? 0)}`}><Input value={amount} onChange={setAmount} inputMode="numeric" aria-invalid={amount.length > 0 && parsed === null} /></Field>
          <button type="button" onClick={() => setAmount(String(recipient?.dueAmount ?? 0))} className="self-end text-[12px] text-secondary underline">Үлдэгдэл дүнг оруулах</button>
          <Field label="Банкны гүйлгээний дугаар" hint="Банкны нэр + давтагдашгүй дугаар. Гүйлгээний тайлбар биш."><Input value={reference} onChange={setReference} maxLength={120} placeholder="Жишээ: KHAN-4821" /></Field>
          <Button full type="submit" disabled={!valid}>Бүртгэлээ шалгах</Button>
        </>}
      </fieldset>
    </form>
  </Card>;
}
