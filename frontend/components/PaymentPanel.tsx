"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Qr } from "@/components/Qr";
import { Badge, Button, Card, Divider } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { PublicOrder, QpayInvoice, Store } from "@/lib/types";

type PayTab = "BANK" | "QPAY";

/**
 * Захиалга өгсний дараах төлбөр — дансаар эсвэл QPay.
 *
 * QPay credential ирэх хүртэл таб харагдана, дотор нь «Удахгүй».
 * Код ирсний дараа backend env бөглөөд QR + deeplink шууд ажиллана.
 */
export function PaymentPanel({
  order,
  store,
  onClaimed,
}: {
  order: PublicOrder;
  store: Store;
  /** Мэдэгдэл / QPay төлбөр амжилттай явсны дараа дахин ачаалах. */
  onClaimed?: () => void;
}) {
  const bank = store.bank;
  const qpay = store.qpay ?? { enabled: false, ready: false };
  const showBank = Boolean(bank);
  const showChooser = showBank; // данс байвал хоёр сонголт; үгүй бол зөвхөн QPay stub/ready

  // Анхны сонголт — QPay (бэлэн биш байсан ч stub харагдана).
  const [tab, setTab] = useState<PayTab>("QPAY");

  if (!showBank && !qpay.ready) {
    return (
      <Card className="w-full border-warn bg-warn-bg p-4">
        <div className="text-[15px] font-medium text-warn">Төлбөр хүлээгдэж байна</div>
        <p className="mt-1 mb-0 text-[13px] leading-[1.6] text-warn">
          Шилжүүлэх дүн <span className="tnum font-medium">{money(order.dueAmount)}</span>.
          Дансны мэдээллийг авахаар{" "}
          <a href={`tel:${store.phone.replace(/\D/g, "")}`} className="tnum">
            {store.phone}
          </a>{" "}
          дугаарт холбогдоно уу.
        </p>
      </Card>
    );
  }

  return (
    <Card className="w-full p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-medium">Төлбөр хүлээгдэж байна</div>
          <p className="mt-1 mb-0 text-[13px] leading-[1.5] text-ink-2">
            Төлбөрийн хэлбэрээ сонгоно уу. Гүйлгээг баталгаажуулсны дараа захиалга
            баталгаажна.
          </p>
        </div>
      </div>

      {showChooser && (
        <div
          className="mt-3 grid grid-cols-2 gap-1 rounded-[8px] border border-line bg-surface p-1"
          role="tablist"
          aria-label="Төлбөрийн хэлбэр"
        >
          <TabButton active={tab === "QPAY"} onClick={() => setTab("QPAY")}>
            QPay
          </TabButton>
          <TabButton active={tab === "BANK"} onClick={() => setTab("BANK")}>
            Дансаар
          </TabButton>
        </div>
      )}

      <Divider className="my-3" />

      {tab === "BANK" && bank ? (
        <BankPay
          order={order}
          store={store}
          bank={bank}
          onClaimed={onClaimed}
        />
      ) : (
        <QpayPay order={order} store={store} ready={qpay.ready} onPaid={onClaimed} />
      )}
    </Card>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`cursor-pointer rounded-[6px] px-3 py-2 text-[13px] font-medium transition-colors ${
        active ? "bg-bg text-ink shadow-sm" : "text-muted hover:text-ink-2"
      }`}
    >
      {children}
    </button>
  );
}

function BankPay({
  order,
  store,
  bank,
  onClaimed,
}: {
  order: PublicOrder;
  store: Store;
  bank: NonNullable<Store["bank"]>;
  onClaimed?: () => void;
}) {
  const toast = useToast();
  const [claimedAt, setClaimedAt] = useState(order.paymentClaimedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.claimPayment(order.code);
      setClaimedAt(result.paymentClaimedAt);
      toast.success("Шилжүүлсэн гэж мэдэгдлээ.");
      onClaimed?.();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Мэдэгдэж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <Row label="Шилжүүлэх дүн" value={money(order.dueAmount)} big />
        {bank.name && <Row label="Банк" value={bank.name} />}
        <Row label="Дансны дугаар" value={bank.accountNumber} copy />
        {bank.accountName && <Row label="Хүлээн авагч" value={bank.accountName} />}
        <Row label="Гүйлгээний утга" value={order.code} copy />
      </div>

      <p className="mt-3 mb-0 text-[13px] leading-[1.6] text-ink-2">
        Гүйлгээний утгад захиалгын кодоо заавал бичнэ үү.
        {store.unpaidCancelHours > 0 && (
          <>
            {" "}
            <span className="tnum">{store.unpaidCancelHours}</span> цагийн дотор
            шилжүүлээгүй бол захиалга цуцлагдана.
          </>
        )}
        {bank.note && <> {bank.note}</>}
      </p>

      <Divider className="my-3" />

      {claimedAt ? (
        <div className="flex items-center justify-between gap-2">
          <div className="rounded-[8px] bg-ok-bg p-3 text-[13px] leading-[1.5] text-ok">
            Мэдэгдлийг хүлээн авлаа. Админ гүйлгээг шалгаад захиалгыг баталгаажуулна.
          </div>
          <Badge tone="info">Мэдэгдсэн</Badge>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[14px]">Шилжүүлэгээ хийсэн үү?</div>
            <div className="text-[13px] text-muted">
              Мэдэгдвэл админ дарааллын эхэнд шалгана
            </div>
          </div>
          <Button variant="outline" onClick={claim} loading={busy}>
            Шилжүүлсэн гэж мэдэгдэх
          </Button>
        </div>
      )}

      {error && <div className="mt-2 text-[13px] text-danger">{error}</div>}
    </>
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

  // Төлбөр орсон эсэхийг poll — callback-ийг нөхөж ажиллана.
  useEffect(() => {
    if (!ready || !invoice) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const st = await api.qpayStatus(order.code);
        if (!cancelled && st.paid) {
          toast.success("QPay төлбөр амжилттай.");
          onPaid?.();
        }
      } catch {
        // Сүлжээний түр алдаа — дараагийн poll үргэлжилнэ.
      }
    };
    const id = window.setInterval(() => void tick(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [ready, invoice, order.code, onPaid, toast]);

  if (!ready) {
    return (
      <div className="rounded-[8px] border border-dashed border-line bg-surface p-4">
        <div className="text-[15px] font-medium">QPay — удахгүй</div>
        <p className="mt-1 mb-0 text-[13px] leading-[1.6] text-ink-2">
          QPay төлбөр бэлтгэгдэж байна. Код ирсний дараа энд QR болон банкны апп
          нээгдэнэ. Одоогоор <span className="font-medium">Дансаар</span> шилжүүлнэ үү.
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
              <div className="flex flex-wrap gap-2">
                {invoice.urls.map((u) => (
                  <a
                    key={u.link}
                    href={u.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-[6px] border border-line bg-bg px-3 py-1.5 text-[12px] text-ink no-underline"
                  >
                    {u.name || u.description || "Апп"}
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
            Төлбөр ормогц энэ хуудас автоматаар шинэчлэгдэнэ.
            {store.unpaidCancelHours > 0 && (
              <>
                {" "}
                <span className="tnum">{store.unpaidCancelHours}</span> цагийн дотор
                төлөөгүй бол захиалга цуцлагдана.
              </>
            )}
          </p>
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

function Row({
  label,
  value,
  big,
  copy,
}: {
  label: string;
  value: string;
  big?: boolean;
  copy?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[13px] text-muted">{label}</span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span
          className={`tnum text-right break-all ${big ? "text-[22px] font-medium" : "text-[15px]"}`}
        >
          {value}
        </span>
        {copy && <CopyButton value={value} label={label} />}
      </span>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`${label} хуулах`}
      className="shrink-0 cursor-pointer rounded-[6px] border border-line bg-bg px-2 py-1 text-[12px] text-ink-2"
    >
      {done ? "Хуулсан" : "Хуулах"}
    </button>
  );
}
