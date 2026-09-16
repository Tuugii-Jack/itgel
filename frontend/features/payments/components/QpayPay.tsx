"use client";

import { useCallback, useEffect, useState } from "react";
import { deferEffect } from "@/lib/deferEffect";
import { useOnKeyChange } from "@/lib/syncKey";
import { Qr } from "@/components/Qr";
import { Button, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { leasingFeePercentOf, formatLeasingPercent, leasingNowPayAmount, isLeasingSplitPay } from "@/lib/leasing";
import { useToast } from "@/lib/toast";
import type { PublicOrder, QpayInvoice, Store } from "@/lib/types";
import { PaymentRow as Row } from "./PaymentRow";

export function QpayPay({
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

  const loadInvoice = useCallback(async (amount?: number) => {
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
  }, [order.code, toast]);

  const invoiceKey = [
    String(ready),
    order.code,
    String(order.nextPayKind ?? ""),
    String(order.leasingFeePaid),
    String(splitPay),
    String(suggestedSplit),
  ].join("|");
  useOnKeyChange(invoiceKey, () => {
    if (ready) setInvoice(null);
  });
  useOnKeyChange(`${order.code}|${String(splitPay)}|${suggestedSplit}`, () => {
    if (splitPay) setSplitAmount(suggestedSplit > 0 ? String(suggestedSplit) : "");
  });

  const requestedKind = splitPay ? "split" : feeFirst ? "fee" : "full";
  const requestedAmount = splitPay
    ? (suggestedSplit > 0 ? suggestedSplit : 0)
    : feeFirst
      ? leasingNowPayAmount(order)
      : 0;

  useEffect(() => {
    if (!ready) return;
    return deferEffect(() => {
      if (requestedKind === "split") {
        if (requestedAmount > 0) void loadInvoice(requestedAmount);
        return;
      }
      void loadInvoice(requestedKind === "fee" ? requestedAmount : undefined);
    });
  }, [ready, requestedKind, requestedAmount, loadInvoice]);

  const verifyPaid = useCallback(async () => {
    setChecking(true);
    try {
      const st = await api.qpayVerify(order.code);
      // Лизингт эхний 10% орсон ч нийт үлдэгдэл үлдэнэ — paidAmount өссөн бол амжилт.
      if (st.paid || st.paidAmount > order.paidAmount) {
        toast.success(
          feeFirst ? "Шимтгэл төлөгдлөө. Захиалга үүслээ." : "QPay төлбөр амжилттай.",
        );
        onPaid?.();
      }
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Төлбөр шалгаж чадсангүй.";
      toast.error(message);
    } finally {
      setChecking(false);
    }
  }, [feeFirst, onPaid, order.code, order.paidAmount, toast]);

  const invoiceId = invoice?.invoiceId;
  useEffect(() => {
    if (!ready || !invoiceId) return;
    const onFocus = () => {
      void verifyPaid();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [ready, invoiceId, verifyPaid]);

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
                {feeFirst
                  ? " шимтгэл төлөөгүй бол захиалга устана."
                  : " төлөөгүй бол захиалга устана. Мөнгө орсон бол үлдэнэ."}
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
