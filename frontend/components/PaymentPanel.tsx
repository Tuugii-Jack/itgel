"use client";

import { useEffect, useState } from "react";
import { PayMethodChoice } from "@/components/PayMethodChoice";
import { LeasingPaySchedule } from "@/components/LeasingPaySchedule";
import { Qr } from "@/components/Qr";
import { Button, Card, Divider, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { orderAccruesStorage } from "@/lib/fulfilment";
import { leasingFeeCaption, leasingFeeOf, leasingFeePercentOf, formatLeasingPercent, leasingNowPayAmount, isLeasingSplitPay, leasingPercentTag } from "@/lib/leasing";
import { useToast } from "@/lib/toast";
import type { PublicOrder, QpayInvoice, Store } from "@/lib/types";

/**
 * Захиалга өгсний дараах төлбөр — төлөөгүй үед сагстай ижил QPay | Лизинг.
 * Лизинг төлөгдсөний дараа үлдэгдэл. Хоёр QPay данс холилдохгүй.
 */
export function PaymentPanel({
  order,
  store,
  onClaimed,
}: {
  order: PublicOrder;
  store: Store;
  onClaimed?: () => void;
}) {
  const netPaid = order.paidAmount - order.refundedAmount;
  const unpaid = netPaid <= 0;
  const leasingPaid = Boolean(order.isLeasing && (order.leasingFeePaid || netPaid > 0));
  const [leasing, setLeasing] = useState(Boolean(order.isLeasing));
  const [switching, setSwitching] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setLeasing(Boolean(order.isLeasing));
  }, [order.isLeasing]);

  const qpay = order.isLeasing
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
      <div className="text-[15px] font-medium">Төлбөрийн хураангуй</div>

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
          <p className="mt-3 mb-0 text-[13px] leading-[1.6] text-ink-2">
            {leasing
              ? "Эхлээд лизингийн шимтгэлийг лизингийн QPay-ээр төлнө. Үндсэн төлбөрийг хуваарьтай төлнө."
              : "Төлбөрийг QPay-ээр төлнө. Төлсний дараа захиалга баталгаажна."}
          </p>
        </>
      ) : (
        <>
          <p className="mt-1 mb-0 text-[13px] leading-[1.5] text-ink-2">
            {leasingPaid
              ? isLeasingSplitPay(order)
                ? "Хуваарьт төлөлтөө төлнө үү. Сүүлийн төлөлт бараа ирэх үетэй давхцана."
                : "Үлдэгдлийг лизингийн QPay-ээр төлнө үү."
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
        />
      )}
    </Card>
  );
}

function QpayPay({
  order,
  store,
  ready,
  hideAmounts,
  onPaid,
}: {
  order: PublicOrder;
  store: Store;
  ready: boolean;
  hideAmounts?: boolean;
  onPaid?: () => void;
}) {
  const toast = useToast();
  const [invoice, setInvoice] = useState<QpayInvoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feeFirst = Boolean(
    order.isLeasing && (order.nextPayKind === "FEE" || !order.leasingFeePaid),
  );
  const splitPay = isLeasingSplitPay(order);
  const maxSplit = order.leasingPrincipalDue ?? order.dueAmount;
  const suggestedSplit = order.payPlan?.nextAmount ?? order.nextPayAmount ?? 0;
  const feePercent = formatLeasingPercent(
    leasingFeePercentOf(order.leasingFee ?? 0, order.subtotal),
  );
  const [splitAmount, setSplitAmount] = useState(
    suggestedSplit > 0 ? String(suggestedSplit) : "",
  );
  const chosenSplit = Number(splitAmount.replace(/\D/g, "")) || 0;
  const payAmount = feeFirst
    ? leasingNowPayAmount(order)
    : splitPay
      ? Math.min(Math.max(0, chosenSplit), maxSplit)
      : (order.nextPayAmount ?? order.dueAmount);
  const payLabel = feeFirst
    ? `Одоо төлөх (${feePercent}% шимтгэл)`
    : splitPay
      ? "Энэ удаагийн төлөлт"
      : "Төлөх дүн";
  const presets = splitPresets(maxSplit, suggestedSplit);

  const loadInvoice = async (amount?: number) => {
    setBusy(true);
    setError(null);
    try {
      const inv = await api.createQpayInvoice(
        order.code,
        amount != null && amount > 0 ? { amount } : undefined,
      );
      setInvoice(inv);
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : "QPay нэхэмжлэл үүсгэж чадсангүй.";
      setError(message);
      if (e instanceof ApiError && e.code !== "QPAY_NOT_READY") {
        toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!ready) return;
    setInvoice(null);
    if (splitPay) {
      const next = suggestedSplit > 0 ? suggestedSplit : 0;
      if (next > 0) void loadInvoice(next);
      return;
    }
    void loadInvoice(feeFirst ? leasingNowPayAmount(order) : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, order.code, order.nextPayKind, order.leasingFeePaid, splitPay, suggestedSplit]);

  useEffect(() => {
    if (!splitPay) return;
    setSplitAmount(suggestedSplit > 0 ? String(suggestedSplit) : "");
  }, [order.code, splitPay, suggestedSplit]);

  const verifyPaid = async () => {
    setChecking(true);
    try {
      const st = await api.qpayVerify(order.code);
      // Лизингт эхний 10% орсон ч нийт үлдэгдэл үлдэнэ — paidAmount өссөн бол амжилт.
      if (st.paid || st.paidAmount > order.paidAmount) {
        toast.success("QPay төлбөр амжилттай.");
        onPaid?.();
      }
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Төлбөр шалгаж чадсангүй.";
      toast.error(message);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!ready || !invoice) return;
    const onFocus = () => {
      void verifyPaid();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- invoice.id / order.code
  }, [ready, invoice?.invoiceId, order.code]);

  if (!ready) {
    return (
      <div className="rounded-[8px] border border-dashed border-line bg-surface p-4">
        <div className="text-[15px] font-medium">
          {order.isLeasing ? "QPay Лизинг бэлэн биш" : "QPay бэлэн биш"}
        </div>
        <p className="mt-1 mb-0 text-[13px] leading-[1.6] text-ink-2">
          QPay түр ажиллахгүй байна.{" "}
          <a href={`tel:${store.phone.replace(/\D/g, "")}`} className="tnum">
            {store.phone}
          </a>{" "}
          дугаарт холбогдоно уу.
        </p>
        <div className="mt-3 text-[13px] text-muted">
          {feeFirst ? `Одоо төлөх (${feePercent}%): ` : splitPay ? "Үндсэн үлдэгдэл: " : "Үлдэгдэл: "}
          <span className="tnum font-medium text-ink">
            {money(feeFirst || splitPay ? leasingNowPayAmount(order) : order.dueAmount)}
          </span>
        </div>
      </div>
    );
  }

  const qrAmount = invoice?.amount ?? payAmount;

  return (
    <div className="flex flex-col gap-3">
      {feeFirst && !hideAmounts && (
        <>
          <Row label={`Одоо төлөх (${feePercent}% шимтгэл)`} value={money(qrAmount || payAmount)} big />
          <Row label="Дараа төлнө (үндсэн)" value={money(order.subtotal)} />
          <Row label="Нийт" value={money(order.dueAmount)} />
        </>
      )}

      {splitPay && (
        <>
          <div>
            <div className="mb-2 text-[13px] text-ink-2">
              Хуваарьт дүн {money(suggestedSplit || maxSplit)}. Хүсвэл өөр дүн оруулж болно.
            </div>
            <div className="mb-2 flex flex-wrap gap-2">
              {presets.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setSplitAmount(String(n));
                    setInvoice(null);
                  }}
                  className={`h-9 cursor-pointer rounded-[8px] border px-3 text-[13px] ${
                    chosenSplit === n
                      ? "border-ink bg-ink text-white"
                      : "border-line bg-bg text-ink"
                  }`}
                >
                  {n === maxSplit ? "Бүгд" : n === suggestedSplit && n !== maxSplit ? "Хуваарь" : money(n)}
                </button>
              ))}
            </div>
            <Input
              value={splitAmount}
              onChange={(v) => {
                setSplitAmount(v.replace(/\D/g, ""));
                setInvoice(null);
              }}
              inputMode="numeric"
              placeholder={`1 – ${maxSplit}`}
            />
          </div>
          <Row label={payLabel} value={money(payAmount)} big />
          {payAmount > 0 && !invoice && (
            <Button
              onClick={() => void loadInvoice(payAmount)}
              loading={busy}
              disabled={payAmount < 1 || payAmount > maxSplit}
            >
              {money(payAmount)}-өөр QR авах
            </Button>
          )}
        </>
      )}

      {!order.isLeasing && !hideAmounts && (
        <Row label={payLabel} value={money(qrAmount || payAmount)} big />
      )}

      {busy && !invoice && !splitPay && (
        <div className="py-6 text-center text-[13px] text-muted">QR үүсгэж байна…</div>
      )}

      {invoice && (
        <>
          {invoice.amount !== payAmount && payAmount > 0 && (
            <Row label="QPay дүн" value={money(invoice.amount)} />
          )}
          <div className="flex flex-col items-center gap-3 py-2">
            {invoice.qrImage ? (
              // QPay base64 PNG
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={
                  invoice.qrImage.startsWith("data:")
                    ? invoice.qrImage
                    : `data:image/png;base64,${invoice.qrImage}`
                }
                alt="QPay QR"
                width={180}
                height={180}
                className="rounded-[8px] border border-line bg-white p-2"
              />
            ) : invoice.qrText ? (
              <Qr value={invoice.qrText} size={160} />
            ) : null}
            <p className="m-0 text-center text-[13px] text-ink-2">
              Банкны аппаараа QR уншуулна уу
            </p>
          </div>

          {invoice.urls.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-[13px] text-muted">Эсвэл банкны апп нээх</div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {invoice.urls.map((u) => (
                  <a
                    key={u.link}
                    href={u.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={u.description || u.name}
                    className="flex flex-col items-center gap-1 rounded-[8px] border border-line bg-bg px-1.5 py-2 no-underline transition-colors hover:border-primary hover:bg-primary-soft"
                  >
                    <BankLogo name={u.name} logo={u.logo} />
                    <span className="line-clamp-2 w-full text-center text-[10px] leading-tight text-ink-2">
                      {u.description || u.name}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {invoice.shortUrl && (
            <a
              href={invoice.shortUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-ink-2"
            >
              QPay холбоос нээх
            </a>
          )}

          <p className="m-0 text-[12px] text-muted">
            Банкны аппаас буцаж ирээд төлбөр автоматаар бүртгэгдэнэ. Хэрэв шинэчлэгдэхгүй бол
            доорх товчийг дарна уу.
            {store.unpaidCancelHours > 0 && (
              <>
                {" "}
                <span className="tnum">{store.unpaidCancelHours}</span> цагийн дотор
                төлөөгүй бол захиалга цуцлагдана.
              </>
            )}
          </p>
          <Button variant="outline" size="sm" onClick={() => void verifyPaid()} loading={checking}>
            Төлбөр шалгах
          </Button>
        </>
      )}

      {error && (
        <div className="flex flex-col gap-2">
          <div className="text-[13px] text-danger">{error}</div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void loadInvoice(splitPay || feeFirst ? payAmount : undefined)
            }
            loading={busy}
            disabled={splitPay && payAmount < 1}
          >
            Дахин оролдох
          </Button>
        </div>
      )}
    </div>
  );
}

function splitPresets(max: number, scheduled = 0): number[] {
  if (max <= 1) return max > 0 ? [max] : [];
  const extra = scheduled > 0 && scheduled < max ? [scheduled] : [];
  const raw = [0.25, 0.5, 1].map((p) => Math.max(1, Math.round(max * p)));
  return [...new Set([...extra, ...raw.filter((n) => n <= max)])];
}

function BankLogo({ name, logo }: { name: string; logo: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!logo || failed) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-surface text-center text-[9px] font-medium leading-tight text-ink">
        {name.slice(0, 8)}
      </span>
    );
  }
  return (
    // QPay CDN — next/image domain бүртгэхгүй.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logo}
      alt={name}
      width={40}
      height={40}
      onError={() => setFailed(true)}
      className="h-10 w-10 rounded-[8px] bg-white object-contain"
    />
  );
}

function Row({
  label,
  value,
  big,
}: {
  label: string;
  value: string;
  big?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[13px] text-muted">{label}</span>
      <span
        className={`tnum min-w-0 text-right break-all ${big ? "text-[22px] font-medium" : "text-[15px]"}`}
      >
        {value}
      </span>
    </div>
  );
}
