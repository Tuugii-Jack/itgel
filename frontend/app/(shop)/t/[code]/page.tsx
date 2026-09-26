"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FulfilmentChooser } from "@/components/FulfilmentChooser";
import { PickupQrCard } from "@/components/shop/PickupQrCard";
import { PaymentPanel } from "@/components/PaymentPanel";
import { OrderContactCard } from "@/components/shop/OrderContactCard";
import { Badge, Button, ErrorNote, Spinner } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { dayLabel, money, rangeLabel, refundPayoutLabel } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import { leasingDueHeadline, leasingFeeCaption, leasingFeeHold, leasingHoldsGoods } from "@/lib/leasing";
import { buildOrderStages } from "@/lib/orderStages";
import {
  orderHasPickup,
  orderAccruesStorage,
  ITEM_FULFILMENT_LABEL,
  itemNeedsFulfilment,
} from "@/lib/fulfilment";
import { PollRetryNote } from "@/components/PollRetryNote";
import { usePolling } from "@/lib/usePolling";
import { isTrackPaymentOpen, shouldPollPayment } from "@/lib/orderPolling";
import { trackedOrderAfterError } from "@/lib/trackedOrders";
import type { PublicOrder } from "@/lib/types";
import type { PollStopReason } from "@/lib/poller";
import {
  STATUS_TONE,
  TrackDetailSkeleton,
  useTrackShell,
} from "../TrackShell";

/**
 * 05 Захиалга хянах — дизайны бүтэц.
 *
 * 6 төлвийг гурван шатны зурвас болгож хураангуйлж, доор нь ирэх огнооны
 * карт тавина. Дизайны хэмжээ: код 22px, зурвас 4px, ETA 20px.
 */
export default function TrackPage() {
  const code = String(useParams<{ code: string }>().code ?? "").toUpperCase();
  return <TrackDetail key={code} code={code} />;
}

function TrackDetail({ code }: { code: string }) {
  const { store, setChromeHidden, trackedOrders, syncOrder } = useTrackShell();
  const [order, setOrder] = useState<PublicOrder | null>(() => trackedOrders.peek(code));
  const mounted = useRef(false);
  /** Дизайны 06 дэлгэц — «Ирсэн барааг авах» дарсны дараа нээгдэнэ. */
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollStopped, setPollStopped] = useState<PollStopReason | null>(null);
  const [pollRestart, setPollRestart] = useState(0);
  /** Upcoming leftover — зөвхөн хэрэглэгчийн оролдлогын paidAmount snapshot. */
  const [prepayAttemptAtPaid, setPrepayAttemptAtPaid] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!code || !mounted.current) return;
    try {
      const next = await trackedOrders.fetch(code);
      if (!mounted.current) return;
      setOrder(next);
      syncOrder(next);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setOrder((current) => trackedOrderAfterError(current, e));
      setError(e instanceof ApiError ? e.message : "Захиалга ачаалж чадсангүй.");
      throw e;
    }
  }, [code, trackedOrders, syncOrder]);

  useEffect(() => {
    mounted.current = true;
    void load().catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    const hide = collecting && Boolean(store);
    setChromeHidden(hide);
    return () => setChromeHidden(false);
  }, [collecting, store, setChromeHidden]);

  useEffect(() => {
    setPrepayAttemptAtPaid(null);
    setPollStopped(null);
  }, [code]);

  const paidSnapshot = order?.paidAmount ?? 0;
  const markPayAttempt = useCallback(() => {
    setPrepayAttemptAtPaid(paidSnapshot);
  }, [paidSnapshot]);
  const unpaid = Boolean(order && store && isTrackPaymentOpen(order));
  const feeHold = Boolean(order && leasingFeeHold(order));
  const polling = Boolean(
    order && store && shouldPollPayment(order, { prepayAttemptAtPaid }),
  );

  // Төлбөр хүлээгдэж байхад төлөвийг автоматаар шинэчилнэ —
  // админ бүртгэмэгц «Төлөгдсөн» гэж харагдана.
  usePolling(load, 15_000, polling, {
    restartKey: pollRestart,
    onStopped: setPollStopped,
  });

  function retryPoll() {
    setPollStopped(null);
    setPollRestart((n) => n + 1);
    void load().catch(() => {});
  }

  if (error && !order) {
    return (
      <div className="px-4 pt-5 lg:px-0 lg:pt-0">
        <ErrorNote>{error}</ErrorNote>
        <Link href="/t" className="mt-4 inline-block text-[13px]">
          Өөр код оруулах
        </Link>
      </div>
    );
  }

  if (!order) {
    return <TrackDetailSkeleton />;
  }

  const dueHead = leasingDueHeadline(order);
  const next = order.nextAction;
  const stages = next?.progress?.length ? next.progress : buildOrderStages(order.status);
  const eta = etaOf(order, next);
  const goodsReady =
    order.canChooseFulfilment || order.items.some(itemNeedsFulfilment);
  const leasingHold = leasingHoldsGoods(order);
  const canCollect = goodsReady && !leasingHold;

  if (canCollect && collecting) {
    if (!store) {
      return (
        <div className="flex justify-center px-4 py-16">
          <Spinner className="text-muted" />
        </div>
      );
    }
    return (
      <FulfilmentChooser
        order={order}
        store={store}
        onDone={(more) => {
          if (!more) setCollecting(false);
          void load().catch(() => {});
        }}
      />
    );
  }

  return (
    <>
      {/* Код ба төлөв */}
      <div className="flex items-start justify-between gap-3 px-4 pt-5 lg:px-0 lg:pt-0">
        <div>
          <div className="tnum text-[22px] font-medium tracking-[0.02em] lg:text-[28px]">
            {order.code}
          </div>
          <div className="tnum text-[13px] text-muted">{dayLabel(order.createdAt)}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {order.isLeasing && <Badge tone="info">Лизинг</Badge>}
          <Badge tone={feeHold ? "warn" : STATUS_TONE[order.status]}>
            {feeHold ? "Шимтгэл хүлээгдэж байна" : order.statusLabel}
          </Badge>
        </div>
      </div>

      {/* Гурван шатны зурвас ба ирэх огноо */}
      <div className="px-4 pt-6 lg:rounded-[12px] lg:border lg:border-line lg:bg-surface lg:px-6 lg:py-6 lg:pt-6">
        <div
          className="grid gap-2 lg:gap-3"
          style={{ gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, minmax(0, 1fr))` }}
        >
          {stages.map((stage) => (
            <div key={stage.key} className="flex flex-col gap-2">
              <div className={`h-1 rounded-full ${stage.reached ? "bg-ink" : "bg-line"}`} />
              <span className={`text-[14px] ${stage.reached ? "text-ink" : "text-muted"}`}>
                {stage.label}
              </span>
            </div>
          ))}
        </div>

        {next && (
          <div className="mt-5 rounded-[12px] border border-line bg-bg p-4 lg:bg-transparent">
            <div className="text-[15px] font-medium">{next.title}</div>
            <p className="mt-1 mb-0 text-[14px] leading-[1.5] text-ink-2">{next.detail}</p>
            {next.nextPayAmount != null && next.nextPayAmount > 0 && (
              <div className="mt-2 tnum text-[14px] text-warn">
                {money(next.nextPayAmount)}
                {next.nextPayAt ? ` · ${dayLabel(next.nextPayAt)}` : ""}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {next.cta === "pay" && store && (unpaid || leasingHold) && (
                <span className="text-[13px] text-muted">Төлбөрийг доор төлнө.</span>
              )}
              {next.cta === "pickup" && (
                <span className="text-[13px] text-muted">Олголтын QR-ийг доор харна.</span>
              )}
              {next.cta === "fulfilment" && canCollect && (
                <Button size="bar" onClick={() => setCollecting(true)}>
                  Авах аргаа сонгох
                </Button>
              )}
              {next.cta === "contact" && order.contact && (
                <span className="text-[13px] text-muted">Холбоо барих мэдээлэл доор байна.</span>
              )}
            </div>
          </div>
        )}

        {(etaFromShown(eta) || canCollect || (leasingHold && goodsReady)) && (
        <div
          className={`mt-5 rounded-[12px] border border-line bg-surface p-4 lg:mt-5 lg:flex lg:items-end lg:justify-between lg:gap-6 lg:rounded-none lg:border-0 lg:p-0 ${
            canCollect ? "cursor-pointer" : ""
          }`}
          onClick={canCollect ? () => setCollecting(true) : undefined}
        >
          {etaFromShown(eta) && (
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-muted">{eta.label}</span>
            <span className="tnum text-[20px] lg:text-[24px]">{eta.value}</span>
            <span className="mt-1 max-w-[520px] text-[14px] leading-[1.5] text-ink-2">
              {leasingHold && goodsReady
                ? "Лизингийн үлдэгдэл төлбөрөө төлнө үү. Төлсний дараа бараагаа авна."
                : eta.note}
            </span>
          </div>
          )}

          {leasingHold && goodsReady && (
            <div className="mt-4 text-[14px] font-medium text-danger lg:mt-0 lg:max-w-[240px] lg:text-right">
              Лизингийн төлбөрөө төлөөрэй
            </div>
          )}
          {canCollect && (
            <Button
              size="bar"
              onClick={() => setCollecting(true)}
              className="mt-4 w-full lg:mt-0 lg:w-auto lg:shrink-0"
            >
              {order.items.some((i) => i.fulfilment)
                ? "Үлдсэн барааг авах"
                : "Ирсэн барааг авах"}
            </Button>
          )}
        </div>
        )}
      </div>

      {/* Агуулахын хадгалалт — хүргэлтээр авна гэснээс хойш харагдахгүй */}
      {order.storage &&
        order.storage.feePerDay > 0 &&
        orderAccruesStorage(order) && (
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

      {/* Мөнгө хүлээж байгаа бол QPay — лизинг үлдэгдэлтэй бол бараанаас өмнө */}
      {(unpaid || leasingHold) && store && (
        <div className="px-4 pt-6 lg:px-0 lg:pt-0">
          {pollStopped === "max_duration" && polling ? (
            <div className="mb-3">
              <PollRetryNote onCheck={retryPoll} />
            </div>
          ) : null}
          {feeHold && (
            <p className="mb-3 mt-0 text-[14px] leading-[1.5] text-ink-2">
              Лизингийн шимтгэлийг төлнө үү. Төлсний дараа захиалга үүснэ.
            </p>
          )}
          <PaymentPanel
            order={order}
            store={store}
            onClaimed={() => { void load().catch(() => {}); }}
            onPayAttempt={markPayAttempt}
            feeHold={feeHold}
          />
        </div>
      )}

      {next?.pickupQr && (
        <div className="px-4 pt-6 lg:px-0 lg:pt-0">
          <PickupQrCard value={next.pickupQr} code={order.code} />
        </div>
      )}

      {/* Сонгосон авах арга */}
      {order.delivery && (
        <div className="px-4 pt-6 lg:px-0 lg:pt-0">
          <div className="overflow-hidden rounded-[12px] border border-line">
            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[15px] font-medium">
                    {orderHasPickup(order) ? "Зарим бараа хүргэлтээр" : "Хүргэлтээр авна"}
                  </div>
                  {order.items.some((item) => item.fulfilment === "DELIVERY") && (
                    <div className="mt-1 text-[13px] text-ink-2">
                      {order.items
                        .filter((item) => !item.cancelled && item.fulfilment === "DELIVERY")
                        .map((item) => item.name)
                        .join(" · ")}
                    </div>
                  )}
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
                  Карго {order.isLeasing ? "— Итгэл " : ""}
                  {money(order.unpaidCargoFee ?? order.dueAmount)} — QPay-ээр төлнө үү.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {orderHasPickup(order) && (
        <div className="px-4 pt-6 lg:px-0 lg:pt-0">
          <div className="overflow-hidden rounded-[12px] border border-line">
            <div className="p-4">
              <div className="text-[15px] font-medium">
                {order.delivery ? "Зарим бараагаа өөрөө авна" : "Өөрөө ирж авах"}
              </div>
              <div className="mt-1 text-[13px] text-ink-2">
                Захиалгын кодоо үзүүлнэ үү — <span className="tnum">{order.code}</span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 border-t border-line bg-surface px-4 py-3.5 text-[14px] text-ink-2">
              {store ? (
                <>
                  <div>{store.address}</div>
                  <div>{store.workHours}</div>
                </>
              ) : null}
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
            {dueHead.label}{" "}
            <span
              className={`tnum ${order.dueAmount > 0 ? "text-warn" : "text-ok"}`}
            >
              {money(dueHead.amount)}
            </span>
          </span>
        </div>
        <div className="flex flex-col gap-3 lg:gap-0">
          {order.items.map((item) => (
            <div
              key={item.id}
              className="flex min-w-0 flex-col gap-1.5 lg:grid lg:grid-cols-[minmax(0,1fr)_110px_minmax(0,190px)_120px] lg:items-center lg:gap-x-5 lg:gap-y-0 lg:border-b lg:border-line lg:px-5 lg:py-3.5"
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
                    <Badge tone="neutral">
                      Авсан {item.handedOverQty ?? item.qty}/{item.qty}
                    </Badge>
                  ) : (item.pickableQty ?? 0) > 0 ? (
                    <Badge tone="ok">
                      Авах {item.pickableQty}/{item.qty}
                      {(item.waitingQty ?? 0) > 0 ? ` · ирээгүй ${item.waitingQty}` : ""}
                    </Badge>
                  ) : (item.arrivedQty ?? 0) > 0 ? (
                    <Badge tone="warn">
                      Ирсэн {item.arrivedQty}/{item.qty} · олгосон {item.handedOverQty ?? 0}
                    </Badge>
                  ) : (
                    <Badge tone="warn">Хүлээж байна</Badge>
                  )}
                </div>
                <span
                  className={`tnum hidden text-[13px] lg:inline ${
                    (item.cancelled || item.itemStatus === "cancelled") && item.refundPaid
                      ? "text-ok"
                      : "text-ink-2"
                  }`}
                >
                  {item.cancelled || item.itemStatus === "cancelled"
                    ? item.refundPayoutOn
                      ? refundPayoutLabel(item.refundPayoutOn, item.refundPaid)
                      : ""
                    : item.itemStatus === "handed_over"
                      ? "Авсан"
                    : item.itemStatus === "arrived"
                      ? item.fulfilment
                        ? ITEM_FULFILMENT_LABEL[item.fulfilment]
                        : "Авах боломжтой"
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
                <div
                  className={`text-[13px] lg:hidden ${item.refundPaid ? "text-ok" : "text-ink-2"}`}
                >
                  {refundPayoutLabel(item.refundPayoutOn, item.refundPaid)}
                </div>
              )}
              {item.itemStatus === "arrived" && (
                <div className="text-[13px] text-ok lg:hidden">
                  {item.fulfilment
                    ? ITEM_FULFILMENT_LABEL[item.fulfilment]
                    : "Авах боломжтой"}
                </div>
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
          {order.isLeasing && (order.leasingFee ?? 0) > 0 && (
            <div className="flex items-center justify-between gap-3 text-[13px] text-ink-2">
              <span>{leasingFeeCaption(order.leasingFee ?? 0, order.subtotal)}</span>
              <span className="tnum">
                {money(order.leasingFee ?? 0)}
                {order.leasingFeePaid ? " · төлсөн" : " · төлөөгүй"}
              </span>
            </div>
          )}
          {order.storageFee > 0 && orderAccruesStorage(order) && (
            <div className="flex items-center justify-between gap-3 text-[13px] text-ink-2">
              <span>Агуулахын хураамж</span>
              <span className="tnum">{money(order.storageFee)}</span>
            </div>
          )}
          {(order.cargoFee ?? 0) > 0 && (
            <div className="flex items-center justify-between gap-3 text-[13px] text-ink-2">
              <span>{order.isLeasing ? "Карго — Итгэл" : "Карго"}</span>
              <span className="tnum">{money(order.cargoFee)}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] text-ink-2">
              {dueHead.label}
            </span>
            <span
              className={`tnum text-[17px] font-medium ${order.dueAmount > 0 ? "text-warn" : "text-ok"}`}
            >
              {money(dueHead.amount)}
            </span>
          </div>
          {order.isLeasing &&
            order.dueAmount > 0 &&
            order.dueAmount !== dueHead.amount && (
              <div className="flex items-center justify-between gap-3 text-[13px] text-ink-2">
                <span>Нийт үлдэгдэл</span>
                <span className="tnum">{money(order.dueAmount)}</span>
              </div>
            )}
          {order.refundedAmount > 0 && (
            <div className="flex items-center justify-between gap-3 text-[13px] text-ink-2">
              <span>Буцаасан</span>
              <span className="tnum">− {money(order.refundedAmount)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Холбоо барих */}
      {order.contact && (
        <div className="mx-4 mb-8 mt-6 lg:mx-0 lg:mb-0 lg:mt-0">
          <OrderContactCard order={order} shopHours={store?.workHours} />
        </div>
      )}
    </>
  );
}

/** Дизайны ETA карт — бодит огноо байвал л харуулна, зохиохгүй. */
function etaOf(
  order: PublicOrder,
  next?: PublicOrder["nextAction"],
): { label: string; value: string; note: string; hasDate: boolean } {
  if (order.status === "CANCELLED") {
    return {
      label: "Төлөв",
      value: "Цуцлагдсан",
      note: order.refundPayoutOn
        ? refundPayoutLabel(order.refundPayoutOn, order.refundPaid)
        : "Энэ захиалга цуцлагдсан. Асуулт байвал бидэнтэй холбогдоно уу.",
      hasDate: false,
    };
  }
  if (order.status === "HANDED_OVER") {
    return {
      label: "Хүлээлгэн өгсөн",
      value: "Дууссан",
      note: "Барааг хүлээлгэн өгсөн. Танд баярлалаа.",
      hasDate: false,
    };
  }

  const from = next?.etaFrom ?? null;
  const to = next?.etaTo ?? null;
  if (from || to) {
    return {
      label: "Ирэх төлөвлөгөө",
      value: from && to && from !== to ? rangeLabel(from, to) : dayLabel((to ?? from)!),
      note: "Энэ нь төлөвлөсөн огноо — ирснийг баталгаажуулаагүй.",
      hasDate: true,
    };
  }

  if (order.status === "ARRIVED") {
    return {
      label: "Агуулахад",
      value: "Ирсэн",
      note: order.fulfilment
        ? "Авах аргаа сонгосон. Товлосон өдөр гарт очно."
        : "Бараа ирлээ. Авах аргаа сонгоно уу.",
      hasDate: false,
    };
  }

  return {
    label: "Гарт очих",
    value: "",
    note:
      order.status === "NEW"
        ? "Төлбөр баталгаажмагц захиалга боловсруулагдана."
        : "Бараа агуулахад ирэхэд танд мэдэгдэнэ.",
    hasDate: false,
  };
}

function etaFromShown(eta: { hasDate: boolean; value: string }): boolean {
  return eta.hasDate && Boolean(eta.value);
}
