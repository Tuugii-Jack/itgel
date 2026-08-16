"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { FulfilmentChooser } from "@/components/FulfilmentChooser";
import { PaymentPanel } from "@/components/PaymentPanel";
import { Badge, Button, ErrorNote, Skeleton, type Tone } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { dayLabel, money, rangeLabel, refundPayoutLabel } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import { useSession } from "@/lib/session";
import { awaitingPayment } from "@/lib/payment";
import { usePolling } from "@/lib/usePolling";
import type { MyOrder, OrderStatus, PublicOrder, Store } from "@/lib/types";

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
  const session = useSession();
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  /** Дизайны 06 дэлгэц — «Ирсэн барааг авах» дарсны дараа нээгдэнэ. */
  const [collecting, setCollecting] = useState(false);
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

  // Нэвтэрсэн бол бусад захиалгыг нь жагсаалтад харуулна.
  useEffect(() => {
    if (!session.me) {
      setMyOrders([]);
      return;
    }
    let alive = true;
    api
      .myOrders()
      .then((r) => alive && setMyOrders(r.data))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [session.me]);

  const unpaid = Boolean(
    order &&
      store &&
      order.status !== "CANCELLED" &&
      order.fulfilment !== "PICKUP" &&
      awaitingPayment(order.paymentState) &&
      order.dueAmount > 0 &&
      order.cargoPayMethod !== "CASH" &&
      !(
        order.paidAmount - order.refundedAmount >= order.subtotal &&
        (order.status === "IN_BATCH" ||
          order.status === "IN_TRANSIT" ||
          (order.status === "ARRIVED" && order.fulfilment === null))
      ),
  );

  // Төлбөр хүлээгдэж байхад төлөвийг автоматаар шинэчилнэ —
  // админ бүртгэмэгц «Төлөгдсөн» гэж харагдана.
  usePolling(load, 15_000, unpaid);

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
      <div className="screen pb-8">
        <div className="px-4 pt-5 lg:px-10 lg:pt-8">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-2 h-4 w-28" />
          <div className="mt-6 grid grid-cols-3 gap-2">
            <Skeleton className="h-1 w-full rounded-full" />
            <Skeleton className="h-1 w-full rounded-full" />
            <Skeleton className="h-1 w-full rounded-full" />
          </div>
          <Skeleton className="mt-5 h-28 w-full rounded-[12px]" />
          <Skeleton className="mt-6 h-40 w-full rounded-[12px]" />
        </div>
      </div>
    );
  }

  const stages = buildStages(order);
  const eta = etaOf(order);

  return (
    <div className="screen pb-8">
      {/*
        Дизайнд «Бараа ирсэн» нь тусдаа дэлгэц (06). Хянах дэлгэцийн дотор
        оруулбал доод талын тогтмол товчны зай нь хуудсыг тасалдуулна.
      */}
      {order.canChooseFulfilment && collecting ? (
        <FulfilmentChooser
          order={order}
          store={store}
          onDone={() => {
            setCollecting(false);
            void load();
          }}
        />
      ) : (
        <>
      {/* Laptop-ийн хуудасны гарчиг */}
      <div className="hidden px-10 pt-8 lg:block">
        <div className="text-[24px] font-medium">Захиалга хянах</div>
      </div>

      <div className="lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start lg:gap-8 lg:px-10 lg:pt-6">
        {/* Дизайны захиалгын жагсаалт — laptop дээр зүүн багана */}
        <OrderList orders={myOrders} current={order.code} />

        <div className="lg:flex lg:flex-col lg:gap-6 lg:min-w-0">
      {/* Мобайл — захиалгууд хэвтээ чип болно */}
      <OrderChips orders={myOrders} current={order.code} />

      {/* Код ба төлөв */}
      <div className="flex items-start justify-between gap-3 px-4 pt-5 lg:px-0 lg:pt-0">
        <div>
          <div className="tnum text-[22px] font-medium tracking-[0.02em] lg:text-[28px]">
            {order.code}
          </div>
          <div className="tnum text-[13px] text-muted">{dayLabel(order.createdAt)}</div>
        </div>
        <Badge tone={STATUS_TONE[order.status]}>{order.statusLabel}</Badge>
      </div>

      {/* Гурван шатны зурвас ба ирэх огноо */}
      <div className="px-4 pt-6 lg:rounded-[12px] lg:border lg:border-line lg:bg-surface lg:px-6 lg:py-6 lg:pt-6">
        <div className="grid grid-cols-3 gap-2 lg:gap-3">
          {stages.map((stage) => (
            <div key={stage.key} className="flex flex-col gap-2">
              <div className={`h-1 rounded-full ${stage.reached ? "bg-ink" : "bg-line"}`} />
              <span className={`text-[14px] ${stage.reached ? "text-ink" : "text-muted"}`}>
                {stage.label}
              </span>
            </div>
          ))}
        </div>

        {/* Мобайл — тусдаа карт; laptop — ижил картын дотор, товч баруун талд */}
        <div className="mt-5 rounded-[12px] border border-line bg-surface p-4 lg:mt-5 lg:flex lg:items-end lg:justify-between lg:gap-6 lg:rounded-none lg:border-0 lg:p-0">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-muted">{eta.label}</span>
            <span className="tnum text-[20px] lg:text-[24px]">{eta.value}</span>
            <span className="mt-1 max-w-[520px] text-[14px] leading-[1.5] text-ink-2">
              {eta.note}
            </span>
          </div>

          {order.canChooseFulfilment && (
            <Button
              size="bar"
              onClick={() => setCollecting(true)}
              className="mt-4 w-full lg:mt-0 lg:w-auto lg:shrink-0"
            >
              Ирсэн барааг авах
            </Button>
          )}
        </div>
      </div>

      {/* Агуулахын хадгалалт — ирсэн бараанд */}
      {order.storage &&
        order.storage.feePerDay > 0 &&
        order.items.some((i) => i.itemStatus === "arrived") && (
          <div className="px-4 pt-6 lg:px-0 lg:pt-0">
            <div
              className={`overflow-hidden rounded-[12px] border p-4 ${
                order.storage.fee > 0
                  ? "border-warn bg-warn-bg"
                  : "border-line bg-surface"
              }`}
            >
              <div
                className={`text-[15px] font-medium ${
                  order.storage.fee > 0 ? "text-warn" : ""
                }`}
              >
                Агуулахын хадгалалт
              </div>
              {order.storage.fee > 0 ? (
                <p className="mt-1 mb-0 text-[14px] leading-[1.5] text-warn">
                  Үнэгүй{" "}
                  <span className="tnum">{order.storage.freeDays}</span> хоног
                  дууссан. Хураамж{" "}
                  <span className="tnum font-medium">{money(order.storage.fee)}</span>
                  {" "}(
                  <span className="tnum">{order.storage.feePerDay.toLocaleString("en-US")}</span>
                  ₮/хоног × бараа). Үлдэгдэлд орсон — авахаасаа өмнө төлнө үү.
                </p>
              ) : (
                <p className="mt-1 mb-0 text-[14px] leading-[1.5] text-ink-2">
                  Ирснээс хойш{" "}
                  <span className="tnum">{order.storage.freeDays}</span> хоног
                  үнэгүй хадгална
                  {order.storage.freeDaysLeft != null ? (
                    <>
                      {" "}
                      — үлдсэн{" "}
                      <span className="tnum font-medium">
                        {order.storage.freeDaysLeft}
                      </span>{" "}
                      хоног
                    </>
                  ) : null}
                  . Дараа нь өдөр бүр{" "}
                  <span className="tnum">
                    {order.storage.feePerDay.toLocaleString("en-US")}
                  </span>
                  ₮ (барааны тоогоор) нэмэгдэнэ.
                </p>
              )}
            </div>
          </div>
        )}

      {/* Мөнгө хүлээж байгаа бол QPay */}
      {unpaid && (
        <div className="px-4 pt-6 lg:px-0 lg:pt-0">
          <PaymentPanel order={order} store={store} onClaimed={load} />
        </div>
      )}

      {/* Сонгосон авах арга */}
      {order.delivery && (
        <div className="px-4 pt-6 lg:px-0 lg:pt-0">
          <div className="overflow-hidden rounded-[12px] border border-line">
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[15px] font-medium">Хүргэлтээр авна</div>
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
              <div className="text-[13px] text-muted">
                Хүргэлтийн төлбөрийг хүргэлтийн компани авна.
              </div>
              {(order.cargoFee ?? 0) > 0 && order.dueAmount > 0 && (
                <div className="tnum text-warn">
                  Карго {money(order.dueAmount)} — QPay-ээр төлнө үү.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {order.fulfilment === "PICKUP" && (
        <div className="px-4 pt-6 lg:px-0 lg:pt-0">
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

      <div className="mt-6 h-px bg-line lg:hidden" />

      {/*
        Захиалсан бараа — мобайл дээр жагсаалт, laptop дээр дизайны 4 баганат
        хүснэгт (нэр / төлөв / ирэх огноо / үнэ) толгойдоо нийт дүнтэй.
      */}
      <div className="px-4 pt-6 lg:overflow-hidden lg:rounded-[12px] lg:border lg:border-line lg:px-0 lg:pt-0">
        <div className="mb-3 text-[15px] font-medium lg:mb-0 lg:flex lg:items-baseline lg:justify-between lg:gap-4 lg:border-b lg:border-line lg:bg-surface lg:px-5 lg:py-3.5">
          <span>Захиалсан бараа</span>
          <span className="hidden text-[14px] font-normal text-ink-2 lg:inline">
            {order.dueAmount > 0 ? "Шилжүүлэх үлдэгдэл " : "Төлсөн, бүтнээр "}
            <span className={`tnum ${order.dueAmount > 0 ? "text-warn" : "text-ok"}`}>
              {money(order.dueAmount > 0 ? order.dueAmount : order.paidAmount - order.refundedAmount)}
            </span>
          </span>
        </div>
        <div className="flex flex-col gap-3 lg:gap-0">
          {order.items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-1.5 lg:grid lg:grid-cols-[minmax(220px,1fr)_110px_190px_120px] lg:items-center lg:gap-x-5 lg:gap-y-0 lg:border-b lg:border-line lg:px-5 lg:py-3.5"
            >
              <div className="flex items-start gap-3 lg:contents">
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-[14px] ${
                      item.cancelled || item.itemStatus === "handed_over"
                        ? "text-muted line-through"
                        : ""
                    }`}
                  >
                    {item.name}
                  </div>
                  <div className="text-[13px] text-muted">
                    {formatSelections(item.selections, item.size, item.color)}
                    {formatSelections(item.selections, item.size, item.color) ? " · " : ""}
                    {item.qty} ш
                  </div>
                </div>
                <div className="lg:justify-self-start">
                  {item.cancelled || item.itemStatus === "cancelled" ? (
                    <Badge tone="danger">Цуцлагдсан</Badge>
                  ) : item.itemStatus === "handed_over" ? (
                    <Badge tone="neutral">Авсан</Badge>
                  ) : item.itemStatus === "arrived" ? (
                    <Badge tone="ok">Ирсэн</Badge>
                  ) : (item.arrivedQty ?? 0) > 0 ? (
                    <Badge tone="warn">
                      {item.arrivedQty}/{item.qty} ирсэн
                    </Badge>
                  ) : (
                    <Badge tone="warn">Хүлээж байна</Badge>
                  )}
                </div>
                <span className="tnum hidden text-[13px] text-ink-2 lg:inline">
                  {item.cancelled || item.itemStatus === "cancelled"
                    ? item.refundPayoutOn
                      ? refundPayoutLabel(item.refundPayoutOn)
                      : ""
                    : item.itemStatus === "handed_over"
                      ? "Авсан"
                      : item.itemStatus === "arrived"
                        ? "Авах боломжтой"
                        : !item.cancelled && item.arriveFrom && item.arriveTo
                          ? `${rangeLabel(item.arriveFrom, item.arriveTo)}-нд ирнэ`
                          : ""}
                </span>
                <div
                  className={`tnum text-[14px] lg:text-right ${
                    item.cancelled || item.itemStatus === "handed_over"
                      ? "text-muted line-through"
                      : ""
                  }`}
                >
                  {money(item.total)}
                </div>
              </div>
              {item.cancelled && item.refundPayoutOn && (
                <div className="text-[13px] text-ink-2 lg:hidden">
                  {refundPayoutLabel(item.refundPayoutOn)}
                </div>
              )}
              {!item.cancelled &&
                item.itemStatus === "waiting" &&
                item.arriveFrom &&
                item.arriveTo && (
                <div className="tnum text-[13px] text-ink-2 lg:hidden">
                  {rangeLabel(item.arriveFrom, item.arriveTo)}-нд ирнэ
                </div>
              )}
              {item.itemStatus === "arrived" && (
                <div className="text-[13px] text-ok lg:hidden">Авах боломжтой</div>
              )}
              {item.itemStatus === "handed_over" && (
                <div className="text-[13px] text-muted lg:hidden">Авсан</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Төлбөр — laptop дээр хүснэгтийн толгойд орсон тул зөвхөн мобайлд */}
      <div className="px-4 pt-6 lg:hidden">
        <div className="flex flex-col gap-2.5 rounded-[12px] border border-line p-3.5">
          {order.storageFee > 0 && (
            <div className="flex items-center justify-between gap-3 text-[13px] text-ink-2">
              <span>Агуулахын хураамж</span>
              <span className="tnum">{money(order.storageFee)}</span>
            </div>
          )}
          {(order.cargoFee ?? 0) > 0 && (
            <div className="flex items-center justify-between gap-3 text-[13px] text-ink-2">
              <span>Карго</span>
              <span className="tnum">{money(order.cargoFee)}</span>
            </div>
          )}
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
      <div className="mx-4 mb-8 mt-6 flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4 lg:mx-0 lg:mb-0 lg:mt-0 lg:p-5">
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
        </div>
      </div>
        </>
      )}
    </div>
  );
}

/**
 * Дизайны захиалгын жагсаалт — laptop дээр зүүн 300px багана.
 * Нэвтэрсэн, нэгээс олон захиалгатай үед л утга учиртай.
 */
function OrderList({ orders, current }: { orders: MyOrder[]; current: string }) {
  if (orders.length < 2) return null;

  return (
    <div className="hidden lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-2.5">
      {orders.map((o) => {
        const active = o.code === current;
        return (
          <Link
            key={o.code}
            href={`/t/${o.code}`}
            className={`flex flex-col gap-2 rounded-[12px] border p-4 no-underline
              ${active ? "border-ink bg-surface" : "border-line bg-bg hover:bg-surface"}`}
          >
            <span className="flex w-full items-start justify-between gap-3">
              <span className="tnum text-[15px]">{o.code}</span>
              <Badge tone={STATUS_TONE[o.status]}>{o.statusLabel}</Badge>
            </span>
            <span className="flex w-full items-center justify-between gap-3 text-[13px] text-muted">
              <span className="tnum">{dayLabel(o.createdAt)}</span>
              <span className="tnum">{money(o.subtotal)}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/** Мобайл дээрх ижил жагсаалт — хэвтээ гүйдэг чипүүд. */
function OrderChips({ orders, current }: { orders: MyOrder[]; current: string }) {
  if (orders.length < 2) return null;

  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pt-3 lg:hidden">
      {orders.map((o) => {
        const active = o.code === current;
        return (
          <Link
            key={o.code}
            href={`/t/${o.code}`}
            className={`tnum flex h-9 shrink-0 items-center rounded-[8px] border px-3 text-[13px] whitespace-nowrap no-underline
              ${active ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"}`}
          >
            {o.code}
          </Link>
        );
      })}
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
      note: order.refundPayoutOn
        ? refundPayoutLabel(order.refundPayoutOn)
        : "Энэ захиалга цуцлагдсан. Асуулт байвал бидэнтэй холбогдоно уу.",
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
