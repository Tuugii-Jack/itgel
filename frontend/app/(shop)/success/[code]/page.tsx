"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { Qr } from "@/components/Qr";
import { Button, ErrorNote, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { money, phoneLabel, rangeLabel } from "@/lib/format";
import { awaitingPayment } from "@/lib/payment";
import type { PublicOrder, Store } from "@/lib/types";

/**
 * 04 Захиалга амжилттай — дизайны хоёр төлөв.
 *
 * Хүлээгдэж буй: данс, гүйлгээний утга, «шилжүүлсэн гэж мэдэгдэх».
 * Баталгаажсан: ногоон тэмдэг, код, QR, хураангуй.
 */
export default function SuccessPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackUrl, setTrackUrl] = useState("");

  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([api.order(code), api.store()]);
      setOrder(o);
      setStore(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const pending =
    order.status !== "CANCELLED" && awaitingPayment(order.paymentState) && order.dueAmount > 0;

  return (
    <div className="screen pb-8">
      {pending ? (
        <Pending order={order} store={store} onClaimed={load} />
      ) : (
        <Confirmed order={order} store={store} trackUrl={trackUrl} />
      )}
    </div>
  );
}

// ------------------------- Төлбөр хүлээгдэж байна -------------------------

function Pending({
  order,
  store,
  onClaimed,
}: {
  order: PublicOrder;
  store: Store | null;
  onClaimed: () => void;
}) {
  const [claimedAt, setClaimedAt] = useState(order.paymentClaimedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bank = store?.bank ?? null;

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.claimPayment(order.code);
      setClaimedAt(result.paymentClaimedAt);
      onClaimed();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Мэдэгдэж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 px-4 pt-8">
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#B45309" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10" cy="10" r="8.2" />
            <path d="M10 5.6 V10 L13.2 11.8" />
          </svg>
          <span className="text-[17px] text-warn">Төлбөр хүлээгдэж байна</span>
        </div>
        <p className="m-0 max-w-[300px] text-center text-[15px] leading-[1.6] text-ink-2">
          {bank
            ? "Доорх дансанд шилжүүлнэ үү. Гүйлгээг баталгаажуулсны дараа захиалга баталгаажна."
            : "Дансны мэдээллийг авахаар бидэнтэй холбогдоно уу."}
        </p>
      </div>

      {/* Дансны карт */}
      <div className="overflow-hidden rounded-[12px] border border-line">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-muted">Шилжүүлэх дүн</span>
            <span className="tnum text-[24px] font-medium">{money(order.dueAmount)}</span>
          </div>
          {bank && (
            <>
              <div className="h-px bg-line" />
              {bank.name && <BankRow label="Банк" value={bank.name} />}
              <BankRow label="Дансны дугаар" value={bank.accountNumber} tnum />
              {bank.accountName && <BankRow label="Хүлээн авагч" value={bank.accountName} />}
            </>
          )}
          {!bank && store && (
            <>
              <div className="h-px bg-line" />
              <BankRow label="Утас" value={store.phone} tnum />
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3.5">
          <div className="min-w-0">
            <div className="text-[13px] text-muted">Гүйлгээний утга</div>
            <div className="tnum text-[18px] font-medium tracking-[0.02em]">{order.code}</div>
          </div>
          <CopyButton value={order.code} />
        </div>
      </div>

      <div className="rounded-[12px] border border-warn-bd bg-warn-bg p-3.5 text-[14px] leading-[1.6] text-warn">
        Гүйлгээний утгад захиалгын кодоо заавал бичнэ үү.
        {store && store.unpaidCancelHours > 0 && (
          <>
            {" "}
            <span className="tnum">{store.unpaidCancelHours}</span> цагийн дотор шилжүүлээгүй бол
            захиалга цуцлагдана.
          </>
        )}
      </div>

      {claimedAt ? (
        <div className="flex items-center gap-3 rounded-[12px] border border-line bg-surface p-4">
          <span className="size-2.5 shrink-0 rounded-full bg-warn" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px]">Шилжүүлэг шалгагдаж байна</div>
            <div className="text-[13px] text-ink-2">Админ гүйлгээг шалгаад баталгаажуулна</div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4">
          <div>
            <div className="text-[15px] font-medium">Шилжүүлэгээ хийсэн үү?</div>
            <div className="mt-0.5 text-[13px] leading-[1.5] text-ink-2">
              Мэдэгдвэл админ дарааллын эхэнд шалгана
            </div>
          </div>
          <Button full onClick={claim} loading={busy}>
            Шилжүүлсэн гэж мэдэгдэх
          </Button>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-col items-center gap-3 pt-1">
        <Link href={`/t/${order.code}`} className="w-full no-underline">
          <Button full size="bar" variant="outline">
            Захиалгаа хянах
          </Button>
        </Link>
        {store && (
          <p className="m-0 text-center text-[13px] text-ink-2">
            Асуух зүйл байвал{" "}
            <a href={`tel:${store.phone.replace(/\D/g, "")}`} className="tnum">
              {store.phone}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

function BankRow({ label, value, tnum }: { label: string; value: string; tnum?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[14px] text-muted">{label}</span>
      <span className={`text-[14px] ${tnum ? "tnum" : ""}`}>{value}</span>
    </div>
  );
}

// --------------------------- Төлбөр баталгаажсан ---------------------------

function Confirmed({
  order,
  store,
  trackUrl,
}: {
  order: PublicOrder;
  store: Store | null;
  trackUrl: string;
}) {
  const arrived = order.timeline.find((s) => s.key === "arrived");
  const eta = arrived?.estimatedAt ?? arrived?.at ?? null;
  const inTransit = order.timeline.find((s) => s.key === "in_transit");
  const etaFrom = inTransit?.estimatedAt ?? eta;
  const cancelled = order.status === "CANCELLED";

  return (
    <>
      <div className="flex flex-col items-center gap-4 px-4 pt-8">
        <div className="flex items-center gap-2">
          {cancelled ? (
            <>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#B91C1C" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="10" cy="10" r="8.2" />
                <path d="M7 7 L13 13 M13 7 L7 13" />
              </svg>
              <span className="text-[17px] text-danger">Захиалга цуцлагдсан</span>
            </>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#15803D" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="10" cy="10" r="8.2" />
                <path d="M6.2 10.2 L8.8 12.8 L13.8 7.6" />
              </svg>
              <span className="text-[17px] text-ok">Төлбөр баталгаажлаа</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <span className="tnum text-[28px] font-medium tracking-[0.02em]">{order.code}</span>
          <CopyButton value={order.code} small />
        </div>

        <div className="size-40 rounded-[12px] border border-line bg-bg p-2.5">
          <Qr value={trackUrl || order.code} size={140} />
        </div>

        <p className="m-0 max-w-[300px] text-center text-[17px] leading-[1.6]">
          {cancelled ? (
            "Энэ захиалга цуцлагдсан байна."
          ) : etaFrom && eta ? (
            <>
              Төлбөр бүрэн төлөгдсөн. Барааг{" "}
              <span className="tnum">{rangeLabel(etaFrom, eta)}</span>-нд ирнэ.
            </>
          ) : (
            "Төлбөр бүрэн төлөгдсөн. Бараа ирэхэд мэдэгдэнэ."
          )}
        </p>
      </div>

      <div className="mt-6 h-px bg-line" />

      {/* Захиалгын хураангуй */}
      <div className="px-4 pt-6">
        <div className="mb-3 text-[15px] font-medium">Захиалгын хураангуй</div>
        <div className="tnum flex flex-col gap-2.5 text-[14px]">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between gap-3">
              <span className={`min-w-0 ${item.cancelled ? "text-muted line-through" : "text-ink-2"}`}>
                {item.name}
                {[item.size, item.color].filter(Boolean).length > 0 &&
                  ` · ${[item.size, item.color].filter(Boolean).join(" · ")}`}
                {item.qty > 1 && ` · ${item.qty} ширхэг`}
              </span>
              <span className={item.cancelled ? "text-muted line-through" : ""}>
                {money(item.total)}
              </span>
            </div>
          ))}
          {order.refundedAmount > 0 && (
            <div className="flex justify-between gap-3">
              <span className="text-ink-2">Буцаасан</span>
              <span>− {money(order.refundedAmount)}</span>
            </div>
          )}
          <div className="h-px bg-line" />
          <div className="flex justify-between gap-3 text-[17px] font-medium">
            <span>{order.dueAmount > 0 ? "Үлдэгдэл" : "Төлсөн, бүтнээр"}</span>
            <span className={order.dueAmount > 0 ? "text-warn" : "text-ok"}>
              {money(order.dueAmount > 0 ? order.dueAmount : order.paidAmount - order.refundedAmount)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 h-px bg-line" />

      <div className="flex flex-col items-center gap-3 px-4 pb-8 pt-6">
        <Link href={`/t/${order.code}`} className="w-full no-underline">
          <Button full size="bar" variant="outline">
            Захиалгаа хянах
          </Button>
        </Link>
        {trackUrl && (
          <span className="break-all text-center text-[13px] text-ink-2">{trackUrl}</span>
        )}
        {store && !cancelled && (
          <p className="m-0 text-center text-[13px] text-ink-2">
            Бараа ирэхэд{" "}
            <span className="tnum">{phoneLabel(order.customer.phone)}</span> дугаар руу SMS
            илгээнэ.
          </p>
        )}
      </div>
    </>
  );
}

/** Дизайны хуулах товч — том 36px, жижиг 32px. */
function CopyButton({ value, small }: { value: string; small?: boolean }) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return; // Clipboard хаалттай — код нүдэн дээрээ харагдсаар байна.
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={`shrink-0 cursor-pointer rounded-[8px] border border-line bg-bg text-[13px] leading-tight text-ink
        ${small ? "h-8 px-2.5" : "h-9 px-3"}`}
    >
      {done ? "Хуулсан" : "Хуулах"}
    </button>
  );
}
