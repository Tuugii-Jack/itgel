"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { FulfilmentChooser } from "@/components/FulfilmentChooser";
import { PaymentPanel } from "@/components/PaymentPanel";
import { Badge, ErrorNote, Spinner, type Tone } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { dayLabel, money, rangeLabel, relativeDay } from "@/lib/format";
import { awaitingPayment } from "@/lib/payment";
import type { OrderStatus, PublicOrder, Store } from "@/lib/types";

const STATUS_TONE: Record<OrderStatus, Tone> = {
  NEW: "neutral",
  CONFIRMED: "info",
  IN_BATCH: "info",
  IN_TRANSIT: "info",
  ARRIVED: "ok",
  HANDED_OVER: "ok",
  CANCELLED: "danger",
};

/**
 * 05 Захиалга хянах — дизайны бүтэц.
 *
 * 6 төлвийг гурван шатны зурвас болгож хураангуйлж, доор нь ирэх огнооны
 * карт тавина. Дизайны хэмжээ: код 22px, зурвас 4px, ETA 20px.
 */
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

  const stages = buildStages(order);
  const eta = etaOf(order);
  const unpaid =
    order.status !== "CANCELLED" && awaitingPayment(order.paymentState) && order.dueAmount > 0;

  return (
    <div className="screen pb-8">
      <div className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b border-line bg-bg px-4">
        <Link
          href="/"
          aria-label="Нүүр"
          className="-ml-3 flex h-11 w-11 items-center justify-center no-underline"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#1C1917" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4 L6 10 L12 16" />
          </svg>
        </Link>
        <span className="text-[15px] font-medium">Захиалга хянах</span>
      </div>

      {/*
        Дизайнд «Бараа ирсэн» нь тусдаа дэлгэц (06). Хянах дэлгэцийн дотор
        оруулбал доод талын тогтмол товчны зай нь хуудсыг тасалдуулна.
      */}
      {order.canChooseFulfilment ? (
        <FulfilmentChooser order={order} store={store} onDone={load} />
      ) : (
        <>
      {/* Код ба төлөв */}
      <div className="flex items-start justify-between gap-3 px-4 pt-5">
        <div>
          <div className="tnum text-[22px] font-medium tracking-[0.02em]">{order.code}</div>
          <div className="tnum text-[13px] text-muted">{dayLabel(order.createdAt)}</div>
        </div>
        <Badge tone={STATUS_TONE[order.status]}>{order.statusLabel}</Badge>
      </div>

      {/* Гурван шатны зурвас ба ирэх огноо */}
      <div className="px-4 pt-6">
        <div className="grid grid-cols-3 gap-2">
          {stages.map((stage) => (
            <div key={stage.key} className="flex flex-col gap-2">
              <div className={`h-1 rounded-full ${stage.reached ? "bg-ink" : "bg-line"}`} />
              <span className={`text-[14px] ${stage.reached ? "text-ink" : "text-muted"}`}>
                {stage.label}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-1 rounded-[12px] border border-line bg-surface p-4">
          <span className="text-[13px] text-muted">{eta.label}</span>
          <span className="tnum text-[20px]">{eta.value}</span>
          <span className="mt-1 text-[14px] leading-[1.5] text-ink-2">{eta.note}</span>
        </div>
      </div>

      {/* Мөнгө хүлээж байгаа бол данс, гүйлгээний утга */}
      {unpaid && (
        <div className="px-4 pt-6">
          <PaymentPanel order={order} store={store} onClaimed={load} />
        </div>
      )}

      {/* Сонгосон авах арга */}
      {order.delivery && (
        <div className="px-4 pt-6">
          <div className="overflow-hidden rounded-[12px] border border-line">
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[15px] font-medium">Хүргэлтээр авна</div>
                  <div className="tnum text-[13px] text-muted">
                    {dayLabel(order.delivery.scheduledDay)} ·{" "}
                    {relativeDay(order.delivery.scheduledDay)}
                  </div>
                </div>
                <Badge tone={order.delivery.status === "DELIVERED" ? "ok" : "info"}>
                  {order.delivery.status === "DELIVERED" ? "Хүргэсэн" : "Товлосон"}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3 text-[14px]">
                <span className="text-muted">Жолооч</span>
                <span className="tnum">{order.delivery.courierName ?? "Хараахан томилоогүй"}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 border-t border-line bg-surface px-4 py-3.5 text-[14px] text-ink-2">
              <div>
                {order.delivery.district}
                {order.delivery.khoroo && `, ${order.delivery.khoroo}`}
                {order.delivery.addressText && `, ${order.delivery.addressText}`}
              </div>
              <div className="tnum">Хүргэлтийн хураамж {money(order.delivery.fee)}</div>
            </div>
          </div>
        </div>
      )}

      {order.fulfilment === "PICKUP" && (
        <div className="px-4 pt-6">
          <div className="overflow-hidden rounded-[12px] border border-line">
            <div className="p-4">
              <div className="text-[15px] font-medium">Өөрөө ирж авах</div>
              <div className="mt-1 text-[13px] text-ink-2">
                Захиалгын кодоо үзүүлнэ үү — <span className="tnum">{order.code}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 border-t border-line bg-surface px-4 py-3.5 text-[14px] text-ink-2">
              <div>{store.address}</div>
              <div>{store.workHours}</div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 h-px bg-line" />

      {/* Захиалсан бараа */}
      <div className="px-4 pt-6">
        <div className="mb-3 text-[15px] font-medium">Захиалсан бараа</div>
        <div className="flex flex-col gap-3">
          {order.items.map((item) => (
            <div key={item.id} className="flex flex-col gap-1.5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className={`text-[14px] ${item.cancelled ? "text-muted line-through" : ""}`}>
                    {item.name}
                  </div>
                  <div className="text-[13px] text-muted">
                    {[item.size, item.color].filter(Boolean).join(" · ")}
                    {[item.size, item.color].filter(Boolean).length > 0 ? " · " : ""}
                    {item.qty} ш
                  </div>
                </div>
                {item.cancelled && <Badge tone="danger">Цуцлагдсан</Badge>}
                <div className={`tnum text-[14px] ${item.cancelled ? "text-muted line-through" : ""}`}>
                  {money(item.total)}
                </div>
              </div>
              {!item.cancelled && item.arriveFrom && item.arriveTo && (
                <div className="tnum text-[13px] text-ink-2">
                  {rangeLabel(item.arriveFrom, item.arriveTo)}-нд ирнэ
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Төлбөр */}
      <div className="px-4 pt-6">
        <div className="flex flex-col gap-2.5 rounded-[12px] border border-line p-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] text-ink-2">
              {order.dueAmount > 0 ? "Шилжүүлэх үлдэгдэл" : "Төлсөн, бүтнээр"}
            </span>
            <span
              className={`tnum text-[17px] font-medium ${order.dueAmount > 0 ? "text-warn" : "text-ok"}`}
            >
              {money(order.dueAmount > 0 ? order.dueAmount : order.paidAmount - order.refundedAmount)}
            </span>
          </div>
          {order.refundedAmount > 0 && (
            <div className="flex items-center justify-between gap-3 text-[13px] text-ink-2">
              <span>Буцаасан</span>
              <span className="tnum">− {money(order.refundedAmount)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Холбоо барих */}
      <div className="mx-4 mb-8 mt-6 flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4">
        <div>
          <div className="text-[15px] font-medium">Асуух зүйл байна уу?</div>
          <div className="mt-0.5 text-[13px] text-ink-2">{store.workHours}</div>
        </div>
        <div className="flex gap-2">
          <a
            href={`tel:${store.phone.replace(/\D/g, "")}`}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[8px] border border-line bg-bg text-[14px] no-underline"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#57534E" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 11.4v2a1.3 1.3 0 0 1-1.5 1.3 12.6 12.6 0 0 1-5.5-2 12.4 12.4 0 0 1-3.8-3.8 12.6 12.6 0 0 1-2-5.5A1.3 1.3 0 0 1 3 2h2a1.3 1.3 0 0 1 1.3 1.1c.1.7.3 1.3.5 1.9a1.3 1.3 0 0 1-.3 1.4l-.8.8a10 10 0 0 0 3.8 3.8l.8-.8a1.3 1.3 0 0 1 1.4-.3c.6.2 1.2.4 1.9.5a1.3 1.3 0 0 1 1.1 1.3Z" />
            </svg>
            Залгах
          </a>
          {store.facebookUrl && (
            <a
              href={store.facebookUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[8px] border border-line bg-bg text-[14px] no-underline"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#57534E" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 1.6c-3.6 0-6.4 2.6-6.4 5.9 0 1.8.9 3.5 2.3 4.6v2.3l2.1-1.2c.6.2 1.3.3 2 .3 3.6 0 6.4-2.6 6.4-5.9S11.6 1.6 8 1.6Z" />
                <path d="M4.6 9.2 6.9 6.8l1.7 1.7 2.3-1.7-2.2 2.4-1.7-1.7-2.4 1.7Z" />
              </svg>
              Messenger
            </a>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}

/**
 * 6 төлвийг дизайны гурван шат болгоно.
 * Цуцлагдсан захиалгад аль ч шат гэрэлтэхгүй.
 */
function buildStages(order: PublicOrder) {
  const reachedIndex: Record<OrderStatus, number> = {
    NEW: 0,
    CONFIRMED: 0,
    IN_BATCH: 1,
    IN_TRANSIT: 1,
    ARRIVED: 2,
    HANDED_OVER: 2,
    CANCELLED: -1,
  };
  const at = reachedIndex[order.status];
  return [
    { key: "placed", label: "Захиалсан" },
    { key: "transit", label: "Замд" },
    { key: "arrived", label: "Гарт очсон" },
  ].map((stage, i) => ({ ...stage, reached: i <= at }));
}

/** Дизайны ETA карт — төлвөөс хамаарч гарчиг, утга, тайлбар өөрчлөгдөнө. */
function etaOf(order: PublicOrder): { label: string; value: string; note: string } {
  if (order.status === "CANCELLED") {
    return {
      label: "Төлөв",
      value: "Цуцлагдсан",
      note: "Энэ захиалга цуцлагдсан. Асуулт байвал бидэнтэй холбогдоно уу.",
    };
  }
  if (order.status === "HANDED_OVER") {
    return {
      label: "Хүлээлгэн өгсөн",
      value: "Дууссан",
      note: "Барааг хүлээлгэн өгсөн. Танд баярлалаа.",
    };
  }
  if (order.status === "ARRIVED") {
    return {
      label: "Агуулахад",
      value: "Ирсэн",
      note: order.fulfilment
        ? "Авах аргаа сонгосон. Товлосон өдөр гарт очно."
        : "Бараа ирлээ. Авах аргаа сонгоно уу.",
    };
  }

  const arrived = order.timeline.find((s) => s.key === "arrived");
  const inTransit = order.timeline.find((s) => s.key === "in_transit");
  const to = arrived?.estimatedAt ?? arrived?.at ?? null;
  const from = inTransit?.estimatedAt ?? to;

  return {
    label: "Гарт очих",
    value: from && to ? rangeLabel(from, to) : "Тодорхойгүй",
    note:
      order.status === "NEW"
        ? "Төлбөр баталгаажмагц захиалга боловсруулагдана."
        : "Бараа агуулахад ирэхэд танд мэдэгдэнэ.",
  };
}
