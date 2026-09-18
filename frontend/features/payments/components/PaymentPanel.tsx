"use client";

import { useState } from "react";
import { useOnKeyChange } from "@/lib/syncKey";
import { PayMethodChoice } from "@/components/PayMethodChoice";
import { LeasingPaySchedule } from "@/components/LeasingPaySchedule";
import { Card, Divider } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { orderAccruesStorage } from "@/lib/fulfilment";
import { leasingFeeCaption, leasingFeeOf, leasingPercentTag, isLeasingSplitPay } from "@/lib/leasing";
import { useToast } from "@/lib/toast";
import type { PublicOrder, Store } from "@/lib/types";
import { PaymentRow as Row } from "./PaymentRow";
import { QpayPay } from "./QpayPay";

/**
 * Захиалга өгсний дараах төлбөр — төлөөгүй үед сагстай ижил QPay | Лизинг.
 * Лизинг төлөгдсөний дараа үлдэгдэл. Хоёр QPay данс холилдохгүй.
 */
export function PaymentPanel({
  order,
  store,
  onClaimed,
  onPayAttempt,
  feeHold,
}: {
  order: PublicOrder;
  store: Store;
  onClaimed?: () => void;
  /** Банк/QR/шалгах — автомат invoice биш. */
  onPayAttempt?: () => void;
  /** Лизингийн шимтгэл төлөгдөх хүртэл захиалга үүсээгүй. */
  feeHold?: boolean;
}) {
  const netPaid = order.paidAmount - order.refundedAmount;
  const unpaid = netPaid <= 0;
  const leasingPaid = Boolean(order.isLeasing && (order.leasingFeePaid || netPaid > 0));
  const leasingPayee = order.payeeKind === "LEASING" || Boolean(order.isLeasing);
  const resale = order.payeeKind === "LEASING" && !order.isLeasing;
  const [leasing, setLeasing] = useState(Boolean(order.isLeasing));
  const [switching, setSwitching] = useState(false);
  const toast = useToast();

  useOnKeyChange(String(Boolean(order.isLeasing)), () => {
    setLeasing(Boolean(order.isLeasing));
  });

  const qpay = leasingPayee
    ? (store.leasingQpay ?? { enabled: false, ready: false })
    : (store.qpay ?? { enabled: false, ready: false });

  const fee = leasing
    ? order.isLeasing && (order.leasingFee ?? 0) > 0
      ? (order.leasingFee ?? 0)
      : leasingFeeOf(order.subtotal, store.leasing?.feeTiers)
    : 0;
  const firstPay = leasing ? fee : order.subtotal;
  const feeLabel = leasingFeeCaption(fee, order.subtotal);

  const applyMethod = async (next: boolean) => {
    if (next === order.isLeasing || switching) return;
    setLeasing(next);
    setSwitching(true);
    try {
      await api.setOrderPayMethod(order.code, { leasing: next });
      onClaimed?.();
    } catch (e) {
      setLeasing(Boolean(order.isLeasing));
      const message =
        e instanceof ApiError ? e.message : "Төлбөрийн хэлбэр солигдсонгүй.";
      toast.error(message);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Card className="w-full p-4">
      <div className="text-[15px] font-medium">
        {feeHold ? "Шимтгэл төлнө" : "Төлбөрийн хураангуй"}
      </div>

      {unpaid ? (
        <>
          <div className="tnum mt-3 flex flex-col gap-2.5 text-[14px]">
            {leasing ? (
              <>
                <Row label="Барааны үнэ" value={money(order.subtotal)} />
                <Row label={feeLabel} value={money(fee)} />
                <Divider className="my-0" />
                <Row label="Эхний төлөлт" value={money(firstPay)} big />
                <Row label="Дараа төлнө (үндсэн)" value={money(order.subtotal)} />
              </>
            ) : (
              <Row label="Одоо төлөх" value={money(order.subtotal)} big />
            )}
          </div>
          {!feeHold && !resale && (
          <div className="mt-4">
            <PayMethodChoice
              leasing={leasing}
              onChange={(v) => void applyMethod(v)}
              disabled={switching}
              subtotal={order.subtotal}
              feeTiers={store.leasing?.feeTiers}
              payGaps={store.leasing?.payGaps}
              payPlan={order.isLeasing ? order.payPlan : null}
              choiceHint={store.leasing?.choiceHint}
              termsTitle={store.leasing?.termsTitle}
              termsBody={store.leasing?.termsBody}
            />
          </div>
          )}
          <p className="mt-3 mb-0 text-[13px] leading-[1.6] text-ink-2">
            {feeHold
              ? "Эхлээд лизингийн шимтгэлийг төлнө. Төлсний дараа захиалга үүснэ."
              : resale
              ? "Төлбөрийг лизингийн QPay-ээр төлнө. Лизингийн хуваарь нэмэгдэхгүй."
              : leasing
              ? "Эхлээд лизингийн шимтгэлийг лизингийн QPay-ээр төлнө. Үндсэн төлбөрийг хуваарьтай төлнө."
              : "Төлбөрийг QPay-ээр төлнө. Төлсний дараа захиалга баталгаажна."}
          </p>
          {leasingPayee && store.leasingBank && (
            <p className="mt-2 mb-0 text-[13px] leading-[1.5] text-ink-2">
              Шилжүүлэг: {store.leasingBank.name} {store.leasingBank.accountNumber}
              {store.leasingBank.accountName ? ` · ${store.leasingBank.accountName}` : ""}
              {store.leasingBank.note ? ` · ${store.leasingBank.note}` : ""}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 mb-0 text-[13px] leading-[1.5] text-ink-2">
            {leasingPaid
              ? isLeasingSplitPay(order)
                ? "Хуваарьт төлөлтөө төлнө үү. Сүүлийн төлөлт бараа ирэх үетэй давхцана."
                : "Үлдэгдлийг лизингийн QPay-ээр төлнө үү."
              : leasingPayee
                ? "Үлдэгдлийг лизингийн QPay-ээр төлнө үү."
                : "Үлдэгдлийг QPay-ээр төлнө үү."}
          </p>
          {order.isLeasing && (
            <div className="tnum mt-3 flex flex-col gap-2.5 text-[14px]">
              <Row
                label={`Шимтгэл${leasingPercentTag(order.leasingFee ?? 0, order.subtotal)}`}
                value={`${money(order.leasingFee ?? 0)} · төлсөн`}
              />
              <Row
                label="Үндсэн үлдэгдэл"
                value={money(order.leasingPrincipalDue ?? order.dueAmount)}
              />
              {(order.storageFee ?? 0) > 0 && orderAccruesStorage(order) && (
                <Row label="Агуулахын хураамж" value={money(order.storageFee)} />
              )}
              {(order.cargoFee ?? 0) > 0 && (
                <Row label="Карго" value={money(order.cargoFee)} />
              )}
              <Row label="Нийт үлдэгдэл" value={money(order.dueAmount)} big />
            </div>
          )}
          {order.isLeasing && order.payPlan && (
            <div className="mt-3">
              <LeasingPaySchedule plan={order.payPlan} />
            </div>
          )}
        </>
      )}

      <Divider className="my-3" />
      {switching ? (
        <div className="py-6 text-center text-[13px] text-muted">
          Төлбөрийн хэлбэр шинэчилж байна…
        </div>
      ) : (
        <QpayPay
          order={order}
          store={store}
          ready={qpay.ready}
          hideAmounts={unpaid}
          onPaid={onClaimed}
          onPayAttempt={onPayAttempt}
        />
      )}
    </Card>
  );
}
