"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { FulfilmentChooser } from "@/components/FulfilmentChooser";
import { PaymentPanel } from "@/components/PaymentPanel";
import { Badge, Card, Divider, ErrorNote, Spinner, type Tone } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { dayLabel, dayTimeLabel, money, relativeDay } from "@/lib/format";
import { awaitingPayment, PAYMENT_HINT, PAYMENT_LABEL, PAYMENT_TONE } from "@/lib/payment";
import type { OrderStatus, PublicOrder, Store, TimelineStep } from "@/lib/types";

const STATUS_TONE: Record<OrderStatus, Tone> = {
  NEW: "neutral",
  CONFIRMED: "info",
  IN_BATCH: "info",
  IN_TRANSIT: "info",
  ARRIVED: "ok",
  HANDED_OVER: "ok",
  CANCELLED: "danger",
};

export default function TrackPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([api.order(code), api.store()]);
      setOrder(o);
      setStore(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Захиалга ачаалж чадсангүй.");
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="p-4">
        <ErrorNote>{error}</ErrorNote>
        <Link href="/t" className="mt-4 inline-block text-[13px]">
          Өөр код оруулах
        </Link>
      </div>
    );
  }

  if (!order || !store) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="text-muted" />
      </div>
    );
  }

  return (
    <div className="screen pb-12">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg px-3 py-3">
        <Link href="/" aria-label="Нүүр" className="no-underline">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#1C1917" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4 L6 10 L12 16" />
          </svg>
        </Link>
        <span className="text-[15px]">Захиалга хянах</span>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 pt-5">
        <span className="tnum text-[24px] font-medium">{order.code}</span>
        <Badge tone={STATUS_TONE[order.status]}>{order.statusLabel}</Badge>
      </div>

      {/* Мөнгө хүлээж байгаа бол данс, гүйлгээний утгыг эндээс дахин харна. */}
      {order.status !== "CANCELLED" &&
        awaitingPayment(order.paymentState) &&
        order.dueAmount > 0 && (
          <div className="px-4 pt-5">
            <PaymentPanel order={order} store={store} onClaimed={load} />
          </div>
        )}

      {/* Бараа ирсэн — авах арга сонгох (дизайны 06 дэлгэц) */}
      {order.canChooseFulfilment && (
        <FulfilmentChooser order={order} store={store} onDone={load} />
      )}

      <div className="px-4 pt-6">
        <div className="mb-3 text-[15px] font-medium">Захиалгын явц</div>
        <Card className="p-4">
          <ol className="m-0 flex list-none flex-col p-0">
            {order.timeline.map((step, i) => (
              <TimelineRow
                key={step.key}
                step={step}
                last={i === order.timeline.length - 1}
              />
            ))}
          </ol>
        </Card>
      </div>

      {order.delivery && (
        <div className="px-4 pt-6">
          <div className="mb-2 text-[15px] font-medium">Хүргэлт</div>
          <Card className="flex flex-col gap-2 p-4 text-[14px]">
            <Line label="Өдөр" value={`${dayLabel(order.delivery.scheduledDay)} (${relativeDay(order.delivery.scheduledDay)})`} />
            <Line label="Дүүрэг" value={order.delivery.district} />
            {order.delivery.khoroo && <Line label="Хороо" value={order.delivery.khoroo} />}
            {order.delivery.addressText && (
              <Line label="Хаяг" value={order.delivery.addressText} />
            )}
            {order.delivery.courierName && (
              <Line label="Жолооч" value={order.delivery.courierName} />
            )}
          </Card>
        </div>
      )}

      <div className="px-4 pt-6">
        <div className="mb-2 text-[15px] font-medium">Захиалсан бараа</div>
        <Card className="divide-y divide-line">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <div
                  className={`text-[14px] leading-[1.4] ${
                    item.cancelled ? "text-muted line-through" : ""
                  }`}
                >
                  {item.name}
                </div>
                <div className="text-[13px] text-muted">
                  {[item.size, item.color].filter(Boolean).join(" · ")}
                  {[item.size, item.color].filter(Boolean).length > 0 ? " · " : ""}
                  {item.qty} ш × {money(item.unitPrice)}
                </div>
                {item.cancelled && (
                  <div className="mt-1.5">
                    <Badge tone="danger">Цуцлагдсан</Badge>
                  </div>
                )}
              </div>
              <span
                className={`tnum shrink-0 text-[14px] ${
                  item.cancelled ? "text-muted line-through" : ""
                }`}
              >
                {money(item.total)}
              </span>
            </div>
          ))}
        </Card>
      </div>

      <div className="px-4 pt-4">
        <Card className="flex flex-col gap-2 p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[15px] font-medium">Төлбөр</span>
            <Badge tone={PAYMENT_TONE[order.paymentState]}>
              {PAYMENT_LABEL[order.paymentState]}
            </Badge>
          </div>
          <Line label="Барааны дүн" value={money(order.subtotal)} />
          {order.deliveryFee > 0 && (
            <Line label="Хүргэлт" value={money(order.deliveryFee)} />
          )}
          <Line label="Төлсөн" value={money(order.paidAmount)} />
          {order.refundedAmount > 0 && (
            <Line label="Буцаасан" value={`− ${money(order.refundedAmount)}`} />
          )}
          <Divider />
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] text-ink-2">Үлдэгдэл</span>
            <span
              className={`tnum text-[17px] font-medium ${
                order.dueAmount > 0 ? "text-warn" : ""
              }`}
            >
              {order.dueAmount === 0 ? "Байхгүй" : money(order.dueAmount)}
            </span>
          </div>
          <p className="mt-1 mb-0 text-[13px] leading-[1.5] text-ink-2">
            {PAYMENT_HINT[order.paymentState]}
            {awaitingPayment(order.paymentState) && (
              <>
                {" "}
                Гүйлгээний утга дээр <span className="tnum">{order.code}</span> кодоо
                бичихээ мартуузай.
              </>
            )}
          </p>
        </Card>
      </div>

      <div className="px-4 pt-6">
        <Card surface className="flex flex-col gap-3 p-4">
          <div className="text-[15px] font-medium">Асуух зүйл байна уу?</div>
          <div className="flex gap-2">
            <a
              href={`tel:${store.phone.replace(/\D/g, "")}`}
              className="flex h-11 flex-1 items-center justify-center rounded-[8px] border border-line bg-bg text-[14px] no-underline"
            >
              Залгах
            </a>
            {store.facebookUrl && (
              <a
                href={store.facebookUrl}
                target="_blank"
                rel="noreferrer"
                className="flex h-11 flex-1 items-center justify-center rounded-[8px] border border-line bg-bg text-[14px] no-underline"
              >
                Messenger
              </a>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function TimelineRow({ step, last }: { step: TimelineStep; last: boolean }) {
  const done = step.status === "done";
  const current = step.status === "current";

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border
            ${done ? "border-ink bg-ink" : current ? "border-info bg-info" : "border-muted bg-bg"}`}
        />
        {!last && <span className={`w-px flex-1 ${done ? "bg-ink/25" : "bg-line"}`} />}
      </div>
      <div className={`flex-1 ${last ? "" : "pb-5"}`}>
        <div
          className={`text-[14px] ${current ? "font-medium text-ink" : done ? "text-ink" : "text-muted"}`}
        >
          {step.label}
        </div>
        <div className="tnum text-[13px] text-ink-2">
          {step.at
            ? dayTimeLabel(step.at)
            : step.estimatedAt
              ? `${dayLabel(step.estimatedAt)} орчим`
              : "Огноо тодорхойгүй"}
        </div>
      </div>
    </li>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[13px] text-muted">{label}</span>
      <span className="tnum text-right text-[14px]">{value}</span>
    </div>
  );
}
