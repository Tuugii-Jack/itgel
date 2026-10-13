"use client";

import Link from "next/link";
import { ArrowUpRight, ChevronRight, Package } from "lucide-react";
import { BATCH_STAGE_LABEL, LeasingBadge, OrderBadge, Table, Td, Th } from "@/components/admin/shared";
import { Badge, Button, Card } from "@/components/ui";
import { customerNameLabel, dayLabel, money, phoneLabel } from "@/lib/format";
import { PAYMENT_LABEL_SHORT, PAYMENT_TONE } from "@/lib/payment";
import type { AdminOrderRow } from "@/lib/types";

export function OrdersList({ orders, selected, canWrite, showDeleted, onToggle, onToggleAll, onOpen }: {
  orders: AdminOrderRow[]; selected: Set<string>; canWrite: boolean; showDeleted: boolean;
  onToggle: (id: string) => void; onToggleAll: (checked: boolean) => void; onOpen: (id: string) => void;
}) {
  const payment = (order: AdminOrderRow) => <>
    <div className="tnum font-medium text-ink">{money(order.subtotal)}</div>
    <div className="mt-1 text-[12px] text-muted">Барааны дүн</div>
    <div className="mt-2"><Badge tone={PAYMENT_TONE[order.paymentState]}>{PAYMENT_LABEL_SHORT[order.paymentState]}</Badge></div>
    {order.dueAmount > 0 && <div className="mt-2 text-[13px] text-warn">Үлдэгдэл <span className="tnum font-medium">{money(order.dueAmount)}</span></div>}
    {order.paymentClaimedAt && order.dueAmount > 0 && <div className="mt-1 text-[12px] text-info">Шилжүүлсэн гэсэн мэдэгдэлтэй</div>}
  </>;
  const progress = (order: AdminOrderRow) => <>
    <OrderBadge status={order.status} />
    {showDeleted ? <div className="mt-2 text-[12px] text-warn">Үлдсэн {order.daysLeft != null ? `${order.daysLeft} хоног` : '—'}</div> : order.batch ? <div className="mt-2 max-w-[190px] text-[12px] leading-relaxed text-ink-2"><div className="truncate">{order.batch.name}</div><div className="text-muted">{BATCH_STAGE_LABEL[order.batch.stage]}</div></div> : <div className="mt-2 text-[12px] text-muted">Багцад ороогүй</div>}
  </>;
  const actions = (order: AdminOrderRow) => <div className="flex flex-wrap items-center gap-2">
    <Button size="sm" variant="outline" onClick={() => onOpen(order.id)}>Нээх <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></Button>
    {!showDeleted && canWrite && !order.isLeasing && !order.isResale && order.dueAmount > 0 && <Button size="sm" variant="ghost" onClick={() => onOpen(order.id)}>Төлбөр</Button>}
    {!showDeleted && order.status === 'ARRIVED' && <Link href={`/workspace/shop/handover?code=${encodeURIComponent(order.code)}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-secondary-soft px-3 text-[12px] font-medium text-secondary no-underline">Олгох<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>}
  </div>;
  return <>
    <Card className="hidden overflow-hidden p-0 md:block">
      <div className="border-b border-line bg-surface px-5 py-3 text-[12px] text-ink-2">Код дээр дарж дэлгэрэнгүй нээнэ. Төлбөр ба барааны явц тусдаа харагдана.</div>
      <Table><thead><tr>
        {canWrite && <Th className="w-12"><input type="checkbox" aria-label="Бүгдийг сонгох" checked={orders.length > 0 && orders.every((order) => selected.has(order.id))} onChange={(event) => onToggleAll(event.target.checked)} className="h-4 w-4 accent-secondary" /></Th>}
        <Th>Захиалга</Th><Th>Хэрэглэгч</Th><Th>Төлбөр</Th><Th>Барааны явц</Th><Th><span className="sr-only">Үйлдэл</span></Th>
      </tr></thead><tbody>{orders.map((order) => <tr key={order.id} className={`transition-colors hover:bg-surface/70 ${selected.has(order.id) ? 'bg-secondary-soft/50' : ''}`}>
        {canWrite && <Td><input type="checkbox" aria-label={`${order.code} сонгох`} checked={selected.has(order.id)} onChange={() => onToggle(order.id)} className="h-4 w-4 accent-secondary" /></Td>}
        <Td className="min-w-[150px]"><button type="button" onClick={() => onOpen(order.id)} className="tnum cursor-pointer text-left text-[14px] font-medium text-ink hover:text-secondary">{order.code}</button><div className="mt-1.5 text-[12px] text-muted">{dayLabel(showDeleted && order.deletedAt ? order.deletedAt : order.createdAt)}</div><div className="mt-2 flex items-center gap-2 text-[12px] text-ink-2"><Package className="h-3.5 w-3.5" aria-hidden="true" />{order.itemCount} ш{order.isLeasing && <LeasingBadge />}</div></Td>
        <Td className="min-w-[160px]"><div className="font-medium">{customerNameLabel(order.customer.name)}</div><div className="mt-1.5 tnum text-[13px] text-muted">{phoneLabel(order.customer.phone)}</div></Td>
        <Td className="min-w-[150px]">{payment(order)}</Td><Td className="min-w-[180px]">{progress(order)}</Td><Td className="max-w-[230px]">{actions(order)}</Td>
      </tr>)}</tbody></Table>
    </Card>
    <div className="flex flex-col gap-3 md:hidden">{orders.map((order) => <Card key={order.id} className={`overflow-hidden p-0 ${selected.has(order.id) ? 'border-secondary' : ''}`}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-start gap-3">{canWrite && <input type="checkbox" aria-label={`${order.code} сонгох`} checked={selected.has(order.id)} onChange={() => onToggle(order.id)} className="mt-1 h-4 w-4 accent-secondary" />}<div><button type="button" onClick={() => onOpen(order.id)} className="tnum text-[15px] font-medium text-ink">{order.code}</button><div className="mt-1 text-[11px] text-muted">{dayLabel(showDeleted && order.deletedAt ? order.deletedAt : order.createdAt)} · {order.itemCount} ш</div></div></div>
        {order.isLeasing && <LeasingBadge />}
      </div>
      <div className="px-4 pt-4"><div className="text-[14px] font-medium">{customerNameLabel(order.customer.name)}</div><div className="mt-1 tnum text-[13px] text-muted">{phoneLabel(order.customer.phone)}</div></div>
      <div className="grid grid-cols-2 gap-4 px-4 py-4"><div>{payment(order)}</div><div>{progress(order)}</div></div>
      <div className="border-t border-line bg-surface px-4 py-3">{actions(order)}</div>
    </Card>)}</div>
  </>;
}
