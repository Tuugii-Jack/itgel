"use client";

import { Card } from "@/components/ui";
import { money } from "@/lib/format";
import { leasingAccountDue, shopDueOf } from "@/lib/leasing";
import type { HandoverPayMethod } from "@/lib/types";
import { lineLeasingDue, lineShopDue, type DueOrderLine } from "../utils";
import { PayMethodPicker } from "./PayMethodPicker";

function SumLine({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 ${
        strong ? "text-[15px] font-medium text-ink" : muted ? "text-[13px] text-muted" : "text-[13px] text-ink-2"
      }`}
    >
      <span>{label}</span>
      <span className="tnum">{value}</span>
    </div>
  );
}

/**
 * Төлбөрийн задаргаа: дэлгүүрийн кассанд авах дүн.
 * Лизингийн үлдэгдлийг энд холихгүй — өөр данс.
 */
export function PaymentDueCard({
  subtotal = 0,
  deliveryFee = 0,
  storageFee = 0,
  cargoFee = 0,
  paidAmount = 0,
  dueAmount,
  shopDueAmount,
  leasingDueAmount,
  isLeasing,
  orders,
  payMethod,
  onPayMethod,
  selectedDue,
}: {
  subtotal?: number;
  deliveryFee?: number;
  storageFee?: number;
  cargoFee?: number;
  paidAmount?: number;
  dueAmount: number;
  shopDueAmount?: number;
  leasingDueAmount?: number;
  isLeasing?: boolean;
  orders?: DueOrderLine[];
  payMethod?: HandoverPayMethod | null;
  onPayMethod?: (v: HandoverPayMethod) => void;
  selectedDue?: number;
}) {
  const fromOrders = orders && orders.length > 0;
  const shopDue = fromOrders
    ? orders.reduce((s, o) => s + lineShopDue(o), 0)
    : (shopDueAmount ?? (isLeasing ? shopDueOf({
        isLeasing,
        subtotal,
        dueAmount,
        storageFee,
        cargoFee,
        paidAmount,
      }) : Math.max(0, dueAmount)));
  const leasingDue = fromOrders
    ? orders.reduce((s, o) => s + lineLeasingDue(o), 0)
    : (leasingDueAmount ?? (isLeasing ? leasingAccountDue({
        isLeasing,
        subtotal,
        dueAmount,
      }) : 0));
  const regularGoods = fromOrders
    ? orders.filter((o) => !o.isLeasing).reduce((s, o) => s + o.subtotal, 0)
    : isLeasing
      ? 0
      : subtotal;
  const leasingGoods = fromOrders
    ? orders.filter((o) => o.isLeasing).reduce((s, o) => s + o.subtotal, 0)
    : isLeasing
      ? subtotal
      : 0;
  const delivery = fromOrders ? orders.reduce((s, o) => s + o.deliveryFee, 0) : deliveryFee;
  const storage = fromOrders ? orders.reduce((s, o) => s + o.storageFee, 0) : storageFee;
  const cargo = fromOrders ? orders.reduce((s, o) => s + (o.cargoFee ?? 0), 0) : cargoFee;
  const paid = fromOrders
    ? orders.filter((o) => !o.isLeasing).reduce((s, o) => s + o.paidAmount, 0)
    : isLeasing
      ? 0
      : paidAmount;
  const collect = selectedDue ?? shopDue;
  const shopUnpaid = (orders ?? []).filter((o) => lineShopDue(o) > 0);

  if (shopDue <= 0 && leasingDue <= 0 && (selectedDue == null || selectedDue <= 0)) {
    return (
      <Card surface className="mb-3 p-4">
        <div className="text-[14px] text-ok">Төлбөр бүрэн төлөгдсөн — авах дүн байхгүй.</div>
      </Card>
    );
  }

  return (
    <Card className="mb-3 overflow-hidden border-line p-0">
      <div className="border-b border-line bg-surface px-4 py-3">
        <div className="text-[13px] text-ink-2">Дэлгүүрт авах дүн</div>
        <div className={`tnum mt-0.5 text-[26px] font-medium leading-tight ${collect > 0 ? "text-warn" : "text-ok"}`}>
          {money(collect > 0 ? collect : 0)}
        </div>
        {selectedDue != null && selectedDue > 0 && selectedDue !== shopDue && (
          <div className="mt-1 text-[12px] text-muted">
            Дэлгүүрийн нийт үлдэгдэл <span className="tnum">{money(shopDue)}</span> · сонгосон захиалга
          </div>
        )}
      </div>

      {leasingDue > 0 && (
        <div className="border-b border-line bg-surface px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-ink-2">Лизингийн үлдэгдэл</span>
            <span className="tnum text-[16px] font-medium text-ink">{money(leasingDue)}</span>
          </div>
          <div className="mt-1 text-[12px] leading-[1.4] text-muted">
            Лизингийн дансанд төлнө. Дэлгүүрийн кассанд бүү ав.
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5 px-4 py-3">
        {regularGoods > 0 && <SumLine label="Бараа" value={money(regularGoods)} />}
        {leasingGoods > 0 && (
          <SumLine label="Бараа (лизинг)" value={money(leasingGoods)} muted />
        )}
        {delivery > 0 && <SumLine label="Хүргэлт" value={money(delivery)} />}
        {cargo > 0 && <SumLine label="Карго" value={money(cargo)} />}
        {storage > 0 && <SumLine label="Агуулахын хураамж" value={money(storage)} />}
        {paid > 0 && (
          <>
            <div className="my-1 h-px bg-line" />
            <SumLine label="Төлсөн" value={`−${money(paid)}`} muted />
          </>
        )}
        <div className="my-1 h-px bg-line" />
        <SumLine label="Дэлгүүрт авах" value={money(shopDue)} strong />
        {leasingDue > 0 && (
          <SumLine label="Лизингийн данс" value={money(leasingDue)} muted />
        )}
      </div>

      {shopUnpaid.length > 1 && (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-2 text-[12px] text-muted">Захиалга бүрээр (дэлгүүр)</div>
          <div className="flex flex-col gap-2">
            {shopUnpaid.map((o) => (
              <div key={o.code} className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="tnum text-ink-2">{o.code}</span>
                <span className="tnum font-medium text-warn">{money(lineShopDue(o))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {onPayMethod && collect > 0 && (
        <PayMethodPicker amount={collect} value={payMethod ?? null} onChange={onPayMethod} />
      )}
    </Card>
  );
}
