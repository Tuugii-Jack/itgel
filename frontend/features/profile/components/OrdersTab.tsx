"use client";

import Link from "next/link";
import {
  Badge,
  Card,
  Divider,
  Empty,
  type Tone,
} from "@/components/ui";
import { dayLabel, money, refundPayoutLabel } from "@/lib/format";
import { leasingFeeHold, leasingHoldsGoods } from "@/lib/leasing";
import { buildOrderStages } from "@/lib/orderStages";
import { awaitingPayment, PAYMENT_LABEL, PAYMENT_TONE } from "@/lib/payment";
import type { MyOrder, OrderStatus } from "@/lib/types";

const STATUS_TONE: Record<OrderStatus, Tone> = {
  NEW: "neutral",
  CONFIRMED: "info",
  IN_BATCH: "info",
  IN_TRANSIT: "info",
  ARRIVED: "ok",
  HANDED_OVER: "ok",
  CANCELLED: "danger",
};

const CTA_LABEL = {
  pay: "Төлөх",
  contact: "Холбогдох",
  pickup: "Авах мэдээлэл",
  fulfilment: "Авах арга",
} as const;

export function OrdersTab({
  orders,
  activeCount,
}: {
  orders: MyOrder[];
  activeCount: number;
}) {
  if (orders.length === 0) {
    return <Empty>Захиалга алга байна.</Empty>;
  }

  return (
    <div className='px-4 pt-4 lg:px-0 lg:pt-0'>
      <div className='mb-3 flex items-baseline justify-between gap-4 text-[13px] text-ink-2'>
        <span className='hidden text-[20px] font-medium text-ink lg:block'>
          Захиалга
        </span>
        <span>
          {activeCount > 0
            ? `${activeCount} захиалга явагдаж байна`
            : "Идэвхтэй захиалга алга"}
        </span>
      </div>

      <div className='flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4'>
        {orders.map((order) => {
          const next = order.nextAction;
          const feeHold = leasingFeeHold(order);
          const stages = next?.progress?.length
            ? next.progress
            : buildOrderStages(order.status, { feeHold });
          const etaFrom = next?.etaFrom;
          const etaTo = next?.etaTo;
          return (
            <Link
              key={order.code}
              href={`/t/${order.code}`}
              className='no-underline'
            >
              <Card className='h-full p-4 lg:p-5'>
                <div className='flex items-start justify-between gap-2'>
                  <div>
                    <div className='tnum text-[15px] font-medium lg:text-[18px] lg:font-normal'>
                      {order.code}
                    </div>
                    <div className='text-[13px] text-muted'>
                      {dayLabel(order.createdAt)} · {order.itemCount} бараа
                    </div>
                  </div>
                  <Badge tone={feeHold ? "warn" : STATUS_TONE[order.status]}>
                    {feeHold ? "Шимтгэл хүлээгдэж байна" : order.statusLabel}
                  </Badge>
                </div>

                <div
                  className='mt-3 grid gap-2'
                  style={{ gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, minmax(0, 1fr))` }}
                >
                  {stages.map((stage) => (
                    <div key={stage.key} className='flex flex-col gap-1.5'>
                      <span
                        className={`h-1 rounded-full ${stage.reached ? "bg-ink" : "bg-line"}`}
                      />
                      <span
                        className={`text-[11px] leading-tight ${stage.reached ? "text-ink" : "text-muted"}`}
                      >
                        {stage.label}
                      </span>
                    </div>
                  ))}
                </div>

                {next && (
                  <div className='mt-3 rounded-[10px] border border-line bg-surface px-3 py-2'>
                    <div className='text-[13px] font-medium'>{next.title}</div>
                    <p className='mt-0.5 mb-0 text-[13px] leading-[1.45] text-ink-2'>
                      {next.detail}
                    </p>
                    {next.cta && (
                      <div className='mt-2'>
                        <Badge tone={next.cta === "pay" ? "warn" : "info"}>
                          {CTA_LABEL[next.cta]}
                        </Badge>
                      </div>
                    )}
                  </div>
                )}

                <Divider className='my-3' />

                <div className='flex items-baseline justify-between gap-2 text-[13px]'>
                  <span className='text-muted'>Төлбөр</span>
                  <span className='tnum'>
                    {money(order.paidAmount)}
                    {order.dueAmount > 0 ? ` · үлдсэн ${money(order.dueAmount)}` : " · төлсөн"}
                  </span>
                </div>
                {next?.nextPayAmount != null && next.nextPayAmount > 0 && (
                  <div className='flex items-baseline justify-between gap-2 text-[13px]'>
                    <span className='text-muted'>
                      {next.key === "pay_overdue" ? "Хугацаа хэтэрсэн" : "Дараагийн төлөлт"}
                    </span>
                    <span className='tnum text-warn'>
                      {money(next.nextPayAmount)}
                      {next.nextPayAt ? ` · ${dayLabel(next.nextPayAt)}` : ""}
                    </span>
                  </div>
                )}
                {(etaFrom || etaTo) && (
                  <div className='flex items-baseline justify-between gap-2 text-[13px]'>
                    <span className='text-muted'>Ирэх төлөвлөгөө</span>
                    <span className='tnum'>
                      {etaFrom && etaTo && etaFrom !== etaTo
                        ? `${dayLabel(etaFrom)} – ${dayLabel(etaTo)}`
                        : dayLabel((etaTo ?? etaFrom)!)}
                    </span>
                  </div>
                )}
                {order.refundPayoutOn && (
                  <div className='flex items-baseline justify-between gap-2 text-[13px]'>
                    <span className='text-muted'>Буцаалт</span>
                    <span className={`text-right ${order.refundPaid ? "text-ok" : ""}`}>
                      {refundPayoutLabel(order.refundPayoutOn, order.refundPaid)}
                    </span>
                  </div>
                )}

                <div className='flex flex-wrap gap-2 pt-3 empty:pt-0'>
                  {order.status !== "CANCELLED" &&
                    awaitingPayment(order.paymentState) && (
                      <Badge tone={PAYMENT_TONE[order.paymentState]}>
                        {PAYMENT_LABEL[order.paymentState]}
                      </Badge>
                    )}
                  {order.canChooseFulfilment && leasingHoldsGoods(order) && (
                    <Badge tone="danger">Лизингийн төлбөрөө төлөөрэй</Badge>
                  )}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <p className='mt-4 mb-0 text-center text-[13px] text-muted'>
        Захиалга дээр дарж дэлгэрэнгүй явцыг харна уу.
      </p>
    </div>
  );
}
