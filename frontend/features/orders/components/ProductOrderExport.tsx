"use client";

import { Printer, Download } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import type { ProductPrintOptions } from '@/lib/roundPrint';

export function ProductOrderExport({ options, onChange, onExport, busy, disabled, scopeLabel }: {
  options: ProductPrintOptions; onChange: (options: ProductPrintOptions) => void;
  onExport: (mode: 'print' | 'excel') => void; busy?: 'print' | 'excel' | null; disabled?: boolean; scopeLabel: string;
}) {
  return <Card className="mb-5 p-4 sm:p-5">
    <div className="text-[15px] font-medium">Хэвлэх / Excel</div>
    <p className="mb-4 mt-1 text-[12px] leading-relaxed text-muted">{scopeLabel}</p>
    <fieldset disabled={busy != null || disabled} className="m-0 flex flex-col gap-4 border-0 p-0">
      <div className="flex flex-wrap gap-x-5 gap-y-3">
        <Check checked={options.customers} onChange={(customers) => onChange({ ...options, customers, phone: customers && options.phone, code: customers && options.code })}>Худалдан авагчид</Check>
        <Check checked={options.phone} disabled={!options.customers} onChange={(phone) => onChange({ ...options, phone })}>Утас</Check>
        <Check checked={options.code} disabled={!options.customers} onChange={(code) => onChange({ ...options, code })}>Захиалгын код</Check>
        <Check checked={options.amounts} onChange={(amounts) => onChange({ ...options, amounts })}>Нэгж үнэ</Check>
      </div>
      <div className="flex flex-wrap gap-2"><Button size="sm" loading={busy === 'print'} onClick={() => onExport('print')}><Printer className="h-4 w-4" aria-hidden="true" />Хэвлэх</Button><Button size="sm" variant="outline" loading={busy === 'excel'} onClick={() => onExport('excel')}><Download className="h-4 w-4" aria-hidden="true" />Excel татах</Button></div>
    </fieldset>
  </Card>;
}

function Check({ checked, onChange, disabled, children }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; children: string }) {
  return <label className={`flex min-h-9 items-center gap-2 text-[13px] ${disabled ? 'text-muted' : 'cursor-pointer'}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-primary" />{children}</label>;
}
