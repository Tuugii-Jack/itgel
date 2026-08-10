"use client";

import { useState } from "react";
import { Badge, Button, Card, Divider } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import type { PublicOrder, Store } from "@/lib/types";

/**
 * Захиалга өгсний дараах төлбөрийн заавар — данс, гүйлгээний утга, хуулах товч.
 *
 * Мөнгө орсныг зөвхөн админ дэвтэрт бүртгэх үед тооцно. Энд байгаа
 * «Шилжүүлсэн гэж мэдэгдэх» нь дарааллын дохио л өгнө.
 */
export function PaymentPanel({
  order,
  store,
  onClaimed,
}: {
  order: PublicOrder;
  store: Store;
  /** Мэдэгдэл амжилттай явсны дараа захиалгыг дахин ачаалах. */
  onClaimed?: () => void;
}) {
  const [claimedAt, setClaimedAt] = useState(order.paymentClaimedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bank = store.bank;
  // Данс тохируулаагүй бол хуурамч мэдээлэл харуулахгүй — дэлгүүр рүү залгуулна.
  if (!bank) {
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

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.claimPayment(order.code);
      setClaimedAt(result.paymentClaimedAt);
      onClaimed?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Мэдэгдэж чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="w-full p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-medium">Төлбөр хүлээгдэж байна</div>
          <p className="mt-1 mb-0 text-[13px] leading-[1.5] text-ink-2">
            Доорх дансанд шилжүүлнэ үү. Гүйлгээг баталгаажуулсны дараа захиалга
            баталгаажна.
          </p>
        </div>
        {claimedAt && <Badge tone="info">Мэдэгдсэн</Badge>}
      </div>

      <Divider className="my-3" />

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
        <div className="rounded-[8px] bg-ok-bg p-3 text-[13px] leading-[1.5] text-ok">
          Мэдэгдлийг хүлээн авлаа. Админ гүйлгээг шалгаад захиалгыг баталгаажуулна.
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
    </Card>
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
      // Clipboard хаалттай (HTTP, зөвшөөрөлгүй) — сонгож өгвөл хэрэглэгч гараар хуулна.
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
