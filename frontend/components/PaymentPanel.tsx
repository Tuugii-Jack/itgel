"use client";

import { useEffect, useState } from "react";
import { Qr } from "@/components/Qr";
import { Button, Card, Divider } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { PublicOrder, QpayInvoice, Store } from "@/lib/types";

/**
 * Захиалга өгсний дараах төлбөр — зөвхөн QPay.
 */
export function PaymentPanel({
  order,
  store,
  onClaimed,
}: {
  order: PublicOrder;
  store: Store;
  /** QPay төлбөр амжилттай явсны дараа дахин ачаалах. */
  onClaimed?: () => void;
}) {
  const qpay = store.qpay ?? { enabled: false, ready: false };

  return (
    <Card className="w-full p-4">
      <div className="text-[15px] font-medium">Төлбөр хүлээгдэж байна</div>
      <p className="mt-1 mb-0 text-[13px] leading-[1.5] text-ink-2">
        QPay-ээр төлнө үү. Төлбөр орсны дараа захиалга баталгаажна.
      </p>
      <Divider className="my-3" />
      <QpayPay order={order} store={store} ready={qpay.ready} onPaid={onClaimed} />
    </Card>
  );
}

function QpayPay({
  order,
  store,
  ready,
  onPaid,
}: {
  order: PublicOrder;
  store: Store;
  ready: boolean;
  onPaid?: () => void;
}) {
  const toast = useToast();
  const [invoice, setInvoice] = useState<QpayInvoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInvoice = async () => {
    setBusy(true);
    setError(null);
    try {
      const inv = await api.createQpayInvoice(order.code);
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
    void loadInvoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- order.code / ready only
  }, [ready, order.code]);

  const verifyPaid = async () => {
    setChecking(true);
    try {
      const st = await api.qpayVerify(order.code);
      if (st.paid) {
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
        <div className="text-[15px] font-medium">QPay бэлэн биш</div>
        <p className="mt-1 mb-0 text-[13px] leading-[1.6] text-ink-2">
          QPay түр ажиллахгүй байна.{" "}
          <a href={`tel:${store.phone.replace(/\D/g, "")}`} className="tnum">
            {store.phone}
          </a>{" "}
          дугаарт холбогдоно уу.
        </p>
        <div className="mt-3 text-[13px] text-muted">
          Төлөх дүн: <span className="tnum font-medium text-ink">{money(order.dueAmount)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Row label="Төлөх дүн" value={money(order.dueAmount)} big />

      {busy && !invoice && (
        <div className="py-6 text-center text-[13px] text-muted">QR үүсгэж байна…</div>
      )}

      {invoice && (
        <>
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
          <Button variant="outline" size="sm" onClick={() => void loadInvoice()} loading={busy}>
            Дахин оролдох
          </Button>
        </div>
      )}
    </div>
  );
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
