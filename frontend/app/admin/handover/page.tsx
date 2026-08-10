"use client";

import { useCallback, useEffect, useState } from "react";
import { QrScanner } from "@/components/QrScanner";
import { OrderBadge, PageHead } from "@/components/admin/shared";
import { Button, Card, Divider, Empty, ErrorNote, Input, Spinner } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { money, phoneLabel } from "@/lib/format";
import type { AdminOrderDetail, AdminOrderRow } from "@/lib/types";

type Found = AdminOrderDetail & { canHandOver: boolean; blockReason: string | null };

/** Ажилтан нөгөө гартаа хайрцаг барьж байгаа — товч доод талд, том. */
export default function HandoverPage() {
  const [pending, setPending] = useState<AdminOrderRow[]>([]);
  const [found, setFound] = useState<Found | null>(null);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** Үлдэгдэлтэй захиалгад бэлэн мөнгө авсныг ажилтан баталгаажуулсан эсэх. */
  const [cashTaken, setCashTaken] = useState(false);

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminApi.orders({ status: "ARRIVED", pageSize: 100 });
      setPending(list.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const lookup = useCallback(async (raw: string) => {
    setError(null);
    setDone(null);
    // QR дотор бүтэн холбоос байж болно — сүүлийн хэсгээс кодыг салгана.
    const match = raw.trim().toUpperCase().match(/PH-[A-Z0-9]{6}/);
    const value = match ? match[0] : raw.trim();
    if (!value) return;

    setBusy(true);
    setScanning(false);
    setCashTaken(false);
    try {
      setFound(await adminApi.handoverLookup(value));
    } catch (e) {
      setFound(null);
      setError(e instanceof ApiError ? e.message : "Хайж чадсангүй.");
    } finally {
      setBusy(false);
    }
  }, []);

  const complete = async () => {
    if (!found) return;
    setBusy(true);
    setError(null);
    try {
      // Үлдэгдлийг ЗААВАЛ илгээнэ. Хоосон явуулбал backend дүнг өөрөө нөхөж
      // бэлэн мөнгө бүртгэдэг тул ажилтан мэдэлгүй төлбөр үүсэх эрсдэлтэй.
      const result = await adminApi.handoverComplete(
        found.id,
        found.dueAmount > 0
          ? { collectedAmount: found.dueAmount, note: "Хүлээлгэн өгөх үед бэлнээр авсан" }
          : { collectedAmount: 0 },
      );
      setDone(result.code);
      setFound(null);
      setCode("");
      setCashTaken(false);
      await loadPending();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Хүлээлгэн өгч чадсангүй.");
    } finally {
      setBusy(false);
    }
  };

  // Байдал 2 — захиалга олдсон
  if (found) {
    return (
      <div className="mx-auto max-w-[480px] pb-28">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="tnum text-[24px] font-medium">{found.code}</div>
            <div className="mt-1">
              <OrderBadge status={found.status} />
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFound(null);
              setCashTaken(false);
            }}
          >
            Цуцлах
          </Button>
        </div>

        <Card className="mb-3 p-4">
          <div className="text-[17px]">{found.customer.name ?? "Нэргүй"}</div>
          <a
            href={`tel:${found.customer.phone}`}
            className="tnum text-[15px] text-ink-2"
          >
            {phoneLabel(found.customer.phone)}
          </a>
        </Card>

        <Card className="mb-3 divide-y divide-line">
          {found.items.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="text-[17px] leading-[1.4]">{item.name}</div>
                {(item.size || item.color) && (
                  <div className="text-[14px] text-muted">
                    {[item.size, item.color].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              <span className="tnum shrink-0 text-[20px] font-medium">{item.qty} ш</span>
            </div>
          ))}
        </Card>

        {found.dueAmount > 0 ? (
          <Card className="mb-3 border-warn bg-warn-bg p-4">
            <div className="text-[13px] text-warn">Авах дүн</div>
            <div className="tnum text-[24px] font-medium text-warn">
              {money(found.dueAmount)}
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-[14px] leading-[1.5]">
              <input
                type="checkbox"
                checked={cashTaken}
                onChange={(e) => setCashTaken(e.target.checked)}
                className="mt-0.5 size-4 shrink-0"
              />
              <span>
                <span className="tnum font-medium">{money(found.dueAmount)}</span>-ийг
                бэлнээр авлаа. Хүлээлгэн өгөхөд энэ дүн төлбөрийн дэвтэрт бичигдэнэ.
              </span>
            </label>
          </Card>
        ) : (
          <Card surface className="mb-3 p-4">
            <div className="text-[14px] text-ok">Төлбөр бүрэн төлөгдсөн — авах дүн байхгүй.</div>
          </Card>
        )}

        <Card surface className="mb-3 p-4 text-[14px]">
          <div className="flex justify-between gap-2">
            <span className="text-ink-2">Авах арга</span>
            <span>
              {found.fulfilment === "DELIVERY"
                ? "Хүргэлт"
                : found.fulfilment === "PICKUP"
                  ? "Өөрөө ирж авах"
                  : "Сонгоогүй"}
            </span>
          </div>
          {found.batch && (
            <div className="mt-1 flex justify-between gap-2">
              <span className="text-ink-2">Багц</span>
              <span>{found.batch.name}</span>
            </div>
          )}
        </Card>

        {error && <ErrorNote>{error}</ErrorNote>}
        {!found.canHandOver && found.blockReason && (
          <div className="mt-3">
            <ErrorNote>{found.blockReason}</ErrorNote>
          </div>
        )}

        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[480px] border-t border-line bg-bg p-4">
          <Button
            full
            onClick={complete}
            loading={busy}
            disabled={!found.canHandOver || (found.dueAmount > 0 && !cashTaken)}
            className="h-14 text-[17px]"
          >
            {found.dueAmount > 0
              ? `${money(found.dueAmount)} авч, хүлээлгэн өгөх`
              : "Хүлээлгэн өгсөн"}
          </Button>
        </div>
      </div>
    );
  }

  // Байдал 1 — скан хүлээж буй
  return (
    <div className="mx-auto max-w-[480px]">
      <PageHead
        title="Хүлээлгэн өгөх"
        hint={loading ? "Ачаалж байна…" : `Өнөөдөр авах ёстой: ${pending.length}`}
      />

      {done && (
        <Card className="mb-4 border-ok bg-ok-bg p-4">
          <span className="tnum text-[14px] text-ok">{done} — хүлээлгэн өгсөн.</span>
        </Card>
      )}

      {scanning ? (
        <div className="mb-4">
          <QrScanner onResult={lookup} />
          <Button full variant="outline" className="mt-3" onClick={() => setScanning(false)}>
            Скан хаах
          </Button>
        </div>
      ) : (
        <Button full variant="outline" className="mb-4 h-14" onClick={() => setScanning(true)}>
          QR уншуулах
        </Button>
      )}

      <Card className="mb-6 flex flex-col gap-3 p-4">
        <div className="text-[14px] text-ink-2">Эсвэл захиалгын код</div>
        <Input
          value={code}
          onChange={(v) => setCode(v.toUpperCase())}
          placeholder="PH-XXXXXX"
          maxLength={9}
        />
        <Button full onClick={() => lookup(code)} loading={busy} disabled={code.length < 3}>
          Хайх
        </Button>
        {error && <ErrorNote>{error}</ErrorNote>}
      </Card>

      <Divider className="mb-4" />

      <div className="mb-2 text-[15px] font-medium">Хүлээгдэж буй</div>
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner className="text-muted" />
        </div>
      ) : pending.length === 0 ? (
        <Empty>Хүлээгдэж буй захиалга алга.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {pending.map((order) => (
            <Card key={order.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="tnum text-[15px] font-medium">{order.code}</div>
                  <div className="text-[13px] text-muted">
                    {order.customer.name ?? "Нэргүй"} ·{" "}
                    <span className="tnum">{phoneLabel(order.customer.phone)}</span>
                  </div>
                </div>
                <OrderBadge status={order.status} />
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2 text-[13px]">
                <span className="text-muted">
                  {order.itemCount} бараа ·{" "}
                  {order.fulfilment === "DELIVERY"
                    ? "Хүргэлт"
                    : order.fulfilment === "PICKUP"
                      ? "Өөрөө авна"
                      : "Сонгоогүй"}
                </span>
                <span className={`tnum ${order.dueAmount > 0 ? "text-warn" : "text-ink-2"}`}>
                  {order.dueAmount > 0 ? `Авах ${money(order.dueAmount)}` : "Төлөгдсөн"}
                </span>
              </div>
              <Button
                full
                variant="outline"
                className="mt-3"
                onClick={() => lookup(order.code)}
              >
                Нээх
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
