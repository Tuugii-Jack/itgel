"use client";

import { LeasingPaySchedule } from "@/components/LeasingPaySchedule";
import { Badge, Button, Card, Divider } from "@/components/ui";
import { money } from "@/lib/format";
import { leasingGoodsArrived, leasingPercentTag, leasingScheduleAlert } from "@/lib/leasing";
import { PAYMENT_TONE } from "@/lib/payment";
import type { AdminOrderDetail, PaymentLedger } from "@/lib/types";

function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[14px]">
      <span className="text-ink-2">{label}</span>
      <span className="tnum">{value}</span>
    </div>
  );
}

export function PaymentSummary({
  order,
  totals,
  leasingPortal,
  busy,
  busyKey,
  smsOpen,
  onOpenPaySms,
}: {
  order: AdminOrderDetail;
  totals: PaymentLedger["totals"];
  leasingPortal: boolean;
  busy: boolean;
  busyKey: string | null;
  smsOpen: boolean;
  onOpenPaySms: () => void;
}) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      {order.isLeasing && (
        <>
          <div className="mb-1 text-[15px] font-medium">Лизинг</div>
          <SumRow
            label={`Шимтгэл${leasingPercentTag(order.leasingFee ?? 0, order.subtotal)}`}
            value={`${money(order.leasingFee ?? 0)}${order.leasingFeePaid ? " · төлсөн" : " · төлөөгүй"}`}
          />
          <SumRow
            label="Үндсэн төлбөр"
            value={`${money(order.leasingPrincipalPaid ?? 0)} / ${money(order.subtotal)}`}
          />
          <SumRow label="Төлсөн дүн" value={money(order.paidAmount)} />
          <SumRow label="Үлдэгдэл" value={money(Math.max(0, order.dueAmount))} />
          {leasingScheduleAlert(order.payPlan) === "overdue" && (
            <div className="rounded-[8px] border border-danger bg-danger-bg px-3 py-2 text-[13px] text-danger">
              Хуваарьт төлөлт хоцорсон — өнөөдөр төлөгдөөгүй.
            </div>
          )}
          {leasingScheduleAlert(order.payPlan) === "due_today" && (
            <div className="rounded-[8px] border border-warn bg-warn-bg px-3 py-2 text-[13px] text-warn">
              Өнөөдрийн хуваарьт төлөлт төлөгдөөгүй байна.
            </div>
          )}
          {order.payPlan && (
            <LeasingPaySchedule plan={order.payPlan} compact />
          )}
          <div className="flex items-baseline justify-between gap-2 text-[14px]">
            <span className="text-ink-2">Төлөлтийн статус</span>
            <Badge tone={PAYMENT_TONE[order.paymentState]}>{order.paymentStateLabel}</Badge>
          </div>
          {leasingPortal && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onOpenPaySms()}
              loading={busyKey === "leasing-sms" && !smsOpen}
              disabled={busy || !order.customer.phone || order.dueAmount <= 0 || Boolean(order.debtClosedAt)}
            >
              Төлбөр сануулах SMS
            </Button>
          )}
          <Divider />
        </>
      )}
      <SumRow label="Барааны дүн" value={money(totals.subtotal)} />
      {totals.deliveryFee > 0 && (
        <SumRow label="Хүргэлт" value={money(totals.deliveryFee)} />
      )}
      {(totals.cargoFee ?? 0) > 0 && (
        <SumRow label="Карго" value={money(totals.cargoFee)} />
      )}
      {(totals.storageFee ?? 0) > 0 && (
        <SumRow label="Агуулахын хураамж" value={money(totals.storageFee)} />
      )}
      <SumRow label="Нийт" value={money(totals.total)} />
      <Divider />
      {order.attributedMoney ? (
        <>
          <SumRow label="Хуваарилсан дүн" value={money(totals.paidAmount)} />
          {(totals.unallocatedPaid ?? 0) > 0 && (
            <SumRow label="Хуваарилаагүй" value={money(totals.unallocatedPaid ?? 0)} />
          )}
        </>
      ) : (
        <SumRow label="Орсон" value={money(totals.paidAmount)} />
      )}
      {totals.refundedAmount > 0 && (
        <SumRow
          label={order.attributedMoney ? "Хуваарилсан буцаалт" : "Буцаасан"}
          value={`−${money(totals.refundedAmount)}`}
        />
      )}
      {order.attributedMoney && (totals.unallocatedRefunded ?? 0) > 0 && (
        <SumRow label="Хуваарилаагүй буцаалт" value={`−${money(totals.unallocatedRefunded ?? 0)}`} />
      )}
      {(order.writtenOffAmount ?? 0) > 0 && (
        <SumRow
          label="Өрийн хаалт"
          value={money(order.writtenOffAmount ?? 0)}
        />
      )}
      {order.debtCloseReason && (
        <div className="text-[13px] text-ink-2">Хаалтын шалтгаан: {order.debtCloseReason}</div>
      )}
      <Divider />
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] text-ink-2">
          {totals.dueAmount < 0 ? "Илүү төлсөн" : "Үлдэгдэл"}
        </span>
        <span
          className={`tnum text-[20px] font-medium ${
            totals.dueAmount > 0
              ? leasingPortal && leasingGoodsArrived(order.status)
                ? "text-danger"
                : "text-warn"
              : totals.dueAmount < 0
                ? "text-info"
                : ""
          }`}
        >
          {money(Math.abs(totals.dueAmount))}
        </span>
      </div>
    </Card>
  );
}
