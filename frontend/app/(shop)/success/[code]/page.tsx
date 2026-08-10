"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { PaymentPanel } from "@/components/PaymentPanel";
import { Qr } from "@/components/Qr";
import { Button, Card, Divider, ErrorNote, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { money, phoneLabel, rangeLabel } from "@/lib/format";
import { awaitingPayment, PAYMENT_HINT } from "@/lib/payment";
import type { PublicOrder, Store } from "@/lib/types";

export default function SuccessPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [trackUrl, setTrackUrl] = useState("");

  useEffect(() => {
    Promise.all([api.order(code), api.store()])
      .then(([o, s]) => {
        setOrder(o);
        setStore(s);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [code]);

  useEffect(() => {
    setTrackUrl(`${window.location.origin}/t/${code}`);
  }, [code]);

  if (error) {
    return (
      <div className="p-4">
        <ErrorNote>{error}</ErrorNote>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="text-muted" />
      </div>
    );
  }

  const showPayment =
    order.status !== "CANCELLED" && awaitingPayment(order.paymentState) && order.dueAmount > 0;

  const arrived = order.timeline.find((s) => s.key === "arrived");
  const eta = arrived?.estimatedAt ?? arrived?.at ?? null;
  const inTransit = order.timeline.find((s) => s.key === "in_transit");
  const etaFrom = inTransit?.estimatedAt ?? eta;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(order.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard эрхгүй бол код нүдэн дээрээ харагдсаар байна.
    }
  };

  return (
    <div className="screen flex flex-col items-center gap-4 px-4 pb-12 pt-8">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ok-bg">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#15803D" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7.4 L6 10.2 L11 4.2" />
          </svg>
        </span>
        <span className="text-[15px]">Захиалга амжирлаа</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="tnum text-[28px] font-medium tracking-[-0.01em]">{order.code}</span>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? "Хуулсан" : "Хуулах"}
        </Button>
      </div>

      {/* Төлбөр бол дараагийн шууд алхам — хураангуйгаас өмнө тавина. */}
      {showPayment && store && (
        <PaymentPanel order={order} store={store} />
      )}

      <Qr value={trackUrl || order.code} size={160} />

      <p className="m-0 max-w-[300px] text-center text-[15px] leading-[1.6]">
        {etaFrom && eta ? (
          <>
            Барааг <span className="tnum">{rangeLabel(etaFrom, eta)}</span>-нд ирнэ. Ирэхэд
            мэдэгдэнэ.
          </>
        ) : (
          "Бараа ирэхэд танд мэдэгдэнэ."
        )}
      </p>

      <Divider className="w-full" />

      <Card className="w-full p-4">
        <div className="mb-3 text-[15px] font-medium">Захиалгын хураангуй</div>
        <div className="flex flex-col gap-2.5">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3">
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
                  {item.qty} ш{item.cancelled ? " · Цуцлагдсан" : ""}
                </div>
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
        </div>

        <Divider className="my-3" />

        <div className="flex flex-col gap-2">
          <SumRow label="Барааны дүн" value={money(order.subtotal)} />
          {order.paidAmount > 0 && (
            <SumRow label="Төлсөн" value={money(order.paidAmount)} />
          )}
          {order.refundedAmount > 0 && (
            <SumRow label="Буцаасан" value={`− ${money(order.refundedAmount)}`} />
          )}
          <SumRow
            label={order.paidAmount > 0 ? "Үлдэгдэл" : "Шилжүүлэх дүн"}
            value={order.dueAmount === 0 ? "Байхгүй" : money(order.dueAmount)}
            strong
            muted={order.dueAmount === 0}
          />
        </div>
      </Card>

      {/* Холбоосыг дараа дахин нээж болох тул шилжүүлэх дүн үлдсэн үед л зааварчилна. */}
      <Card surface className="w-full p-4">
        <div className="text-[15px] font-medium">Дараагийн алхам</div>
        <p className="mt-1 mb-0 text-[13px] text-ink-2">
          {/* Шилжүүлэх зааврыг дээрх самбар хэлсэн тул энд давтахгүй. */}
          {showPayment ? (
            <>Төлбөр баталгаажмагц захиалга боловсруулагдана. </>
          ) : (
            <>{PAYMENT_HINT[order.paymentState]} </>
          )}
          {order.status !== "CANCELLED" && (
            <>
              Бараа ирэхэд{" "}
              <span className="tnum">{phoneLabel(order.customer.phone)}</span> дугаар руу
              SMS илгээнэ.
            </>
          )}
        </p>
      </Card>

      <Link href={`/t/${order.code}`} className="w-full no-underline">
        <Button full size="lg">
          Захиалгаа хянах
        </Button>
      </Link>

      {trackUrl && (
        <span className="break-all text-center text-[12px] text-muted">{trackUrl}</span>
      )}

      {store && (
        <p className="m-0 text-center text-[13px] text-ink-2">
          Асуух зүйл байвал{" "}
          <a href={`tel:${store.phone.replace(/\D/g, "")}`} className="tnum">
            {store.phone}
          </a>
        </p>
      )}
    </div>
  );
}

function SumRow({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={`text-[14px] ${muted ? "text-muted" : "text-ink-2"}`}>{label}</span>
      <span className={`tnum ${strong ? "text-[17px] font-medium" : "text-[14px]"}`}>
        {value}
      </span>
    </div>
  );
}
