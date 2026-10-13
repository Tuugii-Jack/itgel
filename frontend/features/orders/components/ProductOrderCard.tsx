"use client";

import { ChevronRight, Package, Users } from 'lucide-react';
import { ProductStatusBadge } from '@/components/admin/shared';
import { ProductImage } from '@/components/ProductImage';
import { Button, Card } from '@/components/ui';
import { money } from '@/lib/format';
import { formatSelections } from '@/lib/options';
import { closeHint } from '@/lib/roundPrint';
import type { OrdersByProductRow } from '@/lib/types';

export function ProductOrderCard({ row, onOpen }: { row: OrdersByProductRow; onOpen: () => void }) {
  return <Card className="overflow-hidden p-0">
    <div className="flex items-start gap-3 p-4 sm:gap-4 sm:p-5">
      <ProductImage src={row.image} alt={row.name} className="h-16 w-16 shrink-0 rounded-xl sm:h-20 sm:w-20" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted"><span>#{row.roundNo} гаргалт</span><ProductStatusBadge status={row.status} /></div>
        <button type="button" onClick={onOpen} className="mt-2 text-left text-[16px] font-medium leading-snug text-ink hover:text-primary">{row.name}</button>
        <div className="mt-2 text-[12px] leading-relaxed text-ink-2">{closeHint(row)}</div>
      </div>
      <div className="shrink-0 rounded-xl bg-secondary-soft px-3 py-2 text-center text-secondary"><div className="tnum text-[22px] font-medium">{row.qty}</div><div className="text-[11px]">ширхэг</div></div>
    </div>
    <div className="grid gap-3 border-t border-line px-4 py-3 sm:grid-cols-3 sm:px-5">
      <div className="flex items-center gap-2 text-[13px] text-ink-2"><Users className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />{row.customerCount} хүн · {row.orderCount} захиалга</div>
      <div className="text-[13px]"><span className="text-muted">Үндсэн үнэ </span><span className="tnum">{money(row.sellPrice)}</span></div>
      <div className="text-[13px]"><span className="text-muted">Барааны дүн </span><span className="tnum font-medium">{money(row.revenue)}</span></div>
    </div>
    {(row.byVariant.length > 0 || row.byKind.length > 0) && <details className="group border-t border-line">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 bg-surface px-4 text-[13px] sm:px-5"><span className="flex items-center gap-2"><Package className="h-4 w-4 text-muted" aria-hidden="true" />Өнгө, хэмжээний задаргаа{row.byVariant.length > 0 ? ` · ${row.byVariant.length} сонголт` : ''}</span><ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" /></summary>
      <div className="p-4 sm:p-5">
        {row.byVariant.length > 0 && <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{row.byVariant.map((variant, index) => <div key={index} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[13px]"><span className="min-w-0 text-ink-2">{formatSelections(variant.selections, variant.size, variant.color) || 'Сонголтгүй'}</span><strong className="tnum shrink-0 font-medium">{variant.qty} ш</strong></div>)}</div>}
        {row.byKind.length > 0 && <div className="mt-4 space-y-3">{row.byKind.map((kind) => <div key={kind.kind}><div className="mb-2 text-[12px] text-muted">{kind.kind} — нийлбэр</div><div className="flex flex-wrap gap-2">{kind.rows.map((value) => <span key={value.value} className="rounded-lg bg-surface px-3 py-1.5 text-[12px]">{value.value} <strong className="tnum ml-1 font-medium">{value.qty} ш</strong></span>)}</div></div>)}</div>}
      </div>
    </details>}
    <div className="flex justify-end border-t border-line px-4 py-3 sm:px-5"><Button size="sm" variant="outline" onClick={onOpen}>Дэлгэрэнгүй <ChevronRight className="h-4 w-4" aria-hidden="true" /></Button></div>
  </Card>;
}
