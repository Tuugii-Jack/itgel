"use client";

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { OrderBadge, Table, Td, Th } from '@/components/admin/shared';
import { SearchField } from '@/components/admin/SearchField';
import { TaskTabs } from '@/components/admin/TaskTabs';
import { Badge, Button, Card, Empty } from '@/components/ui';
import { filterRoundBuyers, roundBuyerCounts, type BuyerScope } from '../productOrderView';
import { customerNameLabel, dayLabel, money, phoneLabel } from '@/lib/format';
import { formatSelections } from '@/lib/options';
import { PAYMENT_LABEL_SHORT, PAYMENT_TONE } from '@/lib/payment';
import type { RoundBuyer } from '@/lib/types';

export function RoundBuyerList({ orders, onOpenOrder }: { orders: RoundBuyer[]; onOpenOrder?: (orderId: string) => void }) {
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<BuyerScope>('active');
  const counts = roundBuyerCounts(orders);
  const shown = filterRoundBuyers(orders, scope, search);
  const payment = (buyer: RoundBuyer) => <>
    <Badge tone={PAYMENT_TONE[buyer.paymentState]}>{PAYMENT_LABEL_SHORT[buyer.paymentState]}</Badge>
    {!buyer.cancelled && buyer.dueAmount > 0 && <div className="mt-2 text-[12px] text-warn">Захиалгын үлдэгдэл <span className="tnum font-medium">{money(buyer.dueAmount)}</span></div>}
    {buyer.paymentClaimedAt && buyer.dueAmount > 0 && <div className="mt-1 text-[12px] text-info">Шилжүүлсэн гэсэн мэдэгдэлтэй</div>}
  </>;
  const status = (buyer: RoundBuyer) => buyer.cancelled ? <>
    <Badge tone="danger">Цуцлагдсан</Badge>
    {buyer.cancelReason && <div className="mt-2 max-w-48 text-[12px] text-muted">{buyer.cancelReason}</div>}
  </> : <OrderBadge status={buyer.status} />;
  const open = (buyer: RoundBuyer) => onOpenOrder && <Button size="sm" variant="outline" onClick={() => onOpenOrder(buyer.orderId)}>Нээх <ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>;

  return <>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="m-0 text-[16px] font-medium">Худалдан авагчид</h2>
      <span className="text-[12px] text-muted">{shown.length} барааны мөр харагдаж байна</span>
    </div>
    <TaskTabs value={scope} onChange={(value) => setScope(value as BuyerScope)} label="Худалдан авагчийн шүүлт" items={[
      { id: 'active', label: 'Идэвхтэй', count: counts.active },
      { id: 'unpaid', label: 'Үлдэгдэлтэй', count: counts.unpaid },
      { id: 'cancelled', label: 'Цуцлагдсан мөр', count: counts.cancelledRows },
    ]} />
    <SearchField value={search} onChange={setSearch} placeholder="Нэр, утас, код, өнгө эсвэл хэмжээ" className="mb-3" />
    <p className="mb-4 mt-0 text-[12px] leading-relaxed text-muted">Барааны дүн нь энэ гаргалтын мөрийн үнэ. Төлбөрийн төлөв, үлдэгдэл нь тухайн захиалгыг бүхэлд нь илэрхийлнэ.</p>
    {shown.length === 0 ? <Empty>
      {orders.length === 0 ? 'Энэ гаргалтад захиалга алга.' : 'Энэ хайлт, шүүлтэд тохирох мөр алга.'}
      {(search || scope !== 'active') && <Button size="sm" variant="outline" className="mt-3" onClick={() => { setSearch(''); setScope('active'); }}>Хайлт, шүүлтийг цэвэрлэх</Button>}
    </Empty> : <>
      <div className="hidden md:block">
        <Table><thead><tr><Th>Хэрэглэгч / захиалга</Th><Th>Сонголт / барааны дүн</Th><Th>Захиалгын төлбөр</Th><Th>Барааны явц</Th>{onOpenOrder && <Th>Үйлдэл</Th>}</tr></thead>
          <tbody>{shown.map(({ buyer, key }) => <tr key={key} className="hover:bg-surface/70">
            <Td className="min-w-44">
              <div className="font-medium">{customerNameLabel(buyer.customer.name)}</div>
              <div className="mt-1 tnum text-[13px] text-muted">{phoneLabel(buyer.customer.phone)}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
                {onOpenOrder ? <button type="button" onClick={() => onOpenOrder(buyer.orderId)} className="tnum font-medium text-secondary hover:underline">{buyer.code}</button> : <span className="tnum">{buyer.code}</span>}
                <span className="text-muted">{dayLabel(buyer.createdAt)}</span>
              </div>
            </Td>
            <Td className="min-w-44"><div className="text-[13px] text-ink-2">{formatSelections(buyer.selections, buyer.size, buyer.color) || 'Сонголтгүй'}</div><div className="mt-2 tnum text-[13px]">{buyer.qty} ш × {money(buyer.unitPrice)}</div><div className="mt-1 tnum font-medium">{money(buyer.total)}</div></Td>
            <Td className="min-w-40">{payment(buyer)}</Td><Td>{status(buyer)}</Td>{onOpenOrder && <Td>{open(buyer)}</Td>}
          </tr>)}</tbody>
        </Table>
      </div>
      <div className="space-y-3 md:hidden">{shown.map(({ buyer, key }) => <Card key={key} className="p-4">
        <div className="flex items-start justify-between gap-3"><div><div className="font-medium">{customerNameLabel(buyer.customer.name)}</div><div className="mt-1 tnum text-[13px] text-muted">{phoneLabel(buyer.customer.phone)}</div></div>{status(buyer)}</div>
        <div className="my-3 border-y border-line py-3"><div className="text-[13px] text-ink-2">{formatSelections(buyer.selections, buyer.size, buyer.color) || 'Сонголтгүй'}</div><div className="mt-2 flex justify-between gap-3 text-[13px]"><span className="tnum text-muted">{buyer.qty} ш × {money(buyer.unitPrice)}</span><strong className="tnum font-medium">{money(buyer.total)}</strong></div></div>
        <div>{payment(buyer)}</div>
        <div className="mt-3 flex items-center justify-between gap-3"><div><div className="tnum text-[13px] font-medium">{buyer.code}</div><div className="mt-1 text-[11px] text-muted">{dayLabel(buyer.createdAt)}</div></div>{open(buyer)}</div>
      </Card>)}</div>
    </>}
  </>;
}
