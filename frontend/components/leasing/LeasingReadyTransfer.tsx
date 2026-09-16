"use client";

import { useEffect, useState, type ReactNode } from "react";
import { deferEffect } from "@/lib/deferEffect";
import { useOnKeyChange } from "@/lib/syncKey";
import { Button, Card, Divider, ErrorNote, Field, Input, Row, Spinner, Textarea } from "@/components/ui";
import { leasingApi, ApiError } from "@/lib/api";
import { formatSelections } from "@/lib/options";
import { money } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { AdminOrderDetail } from "@/lib/types";

type TransferData = Awaited<ReturnType<typeof leasingApi.readyTransfer>>;
type TransferItem = TransferData["items"][number];
type Preview = Awaited<ReturnType<typeof leasingApi.previewReadyTransfer>>;

export function LeasingReadyTransfer({
  order,
  onDone,
}: {
  order: AdminOrderDetail;
  onDone: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [qtyById, setQtyById] = useState<Record<string, string>>({});
  const [resaleById, setResaleById] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<TransferItem[]>([]);
  const [transfers, setTransfers] = useState<TransferData["transfers"]>([]);

  useOnKeyChange(order.id, () => {
    setOpen(false);
    setReason("");
    setPreview(null);
    setError(null);
  });

  useEffect(() => {
    if (!open) return;
    return deferEffect(() => {
      setLoading(true);
      void leasingApi
        .readyTransfer(order.id)
        .then((data) => {
          setItems(data.items);
          setTransfers(data.transfers);
          setQtyById(
            Object.fromEntries(data.items.filter((i) => i.eligible).map((i) => [i.id, String(i.availableQty)])),
          );
          setResaleById(
            Object.fromEntries(data.items.filter((i) => i.eligible).map((i) => [i.id, String(i.unitPrice)])),
          );
          setPreview(null);
        })
        .catch(() => undefined)
        .finally(() => setLoading(false));
    });
  }, [order.id, open]);

  const eligible = items.filter((item) => item.eligible);
  const blocked = items.filter((item) => !item.eligible && !item.cancelled && !item.transferred);

  const selected = eligible
    .map((item) => ({
      orderItemId: item.id,
      qty: Math.min(item.availableQty, Number(qtyById[item.id] ?? 0) || 0),
      resaleUnitPrice: Number((resaleById[item.id] ?? "").replace(/\D/g, "")) || 0,
    }))
    .filter((line) => line.qty > 0);

  const touch = () => {
    setPreview(null);
    setError(null);
  };

  const close = () => {
    setOpen(false);
    setPreview(null);
    setError(null);
  };

  const runPreview = async () => {
    setError(null);
    if (!reason.trim() || selected.length === 0 || selected.some((l) => l.resaleUnitPrice <= 0)) {
      const message = "Шалтгаан, тоо, дахин борлуулах үнийг оруулна уу.";
      setError(message);
      toast.error(message);
      return;
    }
    setBusy(true);
    try {
      const data = await leasingApi.previewReadyTransfer(order.id, { reason, lines: selected });
      setPreview(data);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Урьдчилан харах боломжгүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await leasingApi.confirmReadyTransfer(order.id, { reason, lines: selected });
      toast.success("Бэлэн бараанд шилжүүллээ.");
      close();
      onDone();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Шилжүүлж чадсангүй.";
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  if (!order.isLeasing || order.isResale) return null;

  if (!open) {
    return (
      <Button
        variant="outline"
        full
        onClick={() => {
          setLoading(true);
          setOpen(true);
        }}
      >
        Бэлэн бараанд шилжүүлэх
      </Button>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <div className="text-[15px] font-medium">Бэлэн бараанд шилжүүлэх</div>
        <p className="m-0 text-[13px] leading-5 text-ink-2">
          Төлсөн мөнгө лизингт үлдэнэ. Буцаалт биш.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <Spinner className="text-muted" />
        </div>
      ) : eligible.length === 0 && blocked.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">Шилжүүлэх боломжтой бараа алга.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {eligible.map((item) => (
            <ItemCard key={item.id} item={item}>
              <div className="flex flex-col gap-3">
                <Field label="Шилжүүлэх тоо" hint={`Ихдээ ${item.availableQty} ширхэг`}>
                  <Input
                    value={qtyById[item.id] ?? ""}
                    onChange={(v) => {
                      touch();
                      setQtyById((prev) => ({ ...prev, [item.id]: v.replace(/\D/g, "") }));
                    }}
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Дахин борлуулах үнэ" hint={`Одоогийн үнэ ${money(item.unitPrice)}`}>
                  <Input
                    value={resaleById[item.id] ?? ""}
                    onChange={(v) => {
                      touch();
                      setResaleById((prev) => ({ ...prev, [item.id]: v.replace(/\D/g, "") }));
                    }}
                    inputMode="numeric"
                  />
                </Field>
              </div>
            </ItemCard>
          ))}
          {blocked.map((item) => (
            <ItemCard key={item.id} item={item}>
              <p className="m-0 text-[13px] leading-5 text-ink-2">
                {item.reason ?? "Энэ барааг шилжүүлэх боломжгүй."}
              </p>
            </ItemCard>
          ))}
        </div>
      )}

      {!loading && eligible.length > 0 && (
        <>
          <Field label="Шалтгаан">
            <Textarea
              value={reason}
              onChange={(v) => {
                touch();
                setReason(v);
              }}
              rows={2}
              placeholder="Яагаад шилжүүлж байна"
            />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          {preview && (
            <div className="flex flex-col gap-2 rounded-[8px] border border-line bg-surface p-3">
              <Row label="Төлсөн (үлдэнэ)" value={money(preview.paidKeptAmount)} />
              <Row label="Үлдсэн бараа" value={`${preview.remainingActiveQty} ш`} />
              {preview.closeDebt ? (
                preview.writeOffAmount > 0 ? (
                  <Row label="Хаагдах өр" value={money(preview.writeOffAmount)} tone="warn" />
                ) : null
              ) : (
                <p className="m-0 text-[13px] leading-5 text-ink-2">
                  Үлдсэн бараа байгаа тул өрийг бүхэлд нь хаахгүй.
                </p>
              )}
              {preview.lines.map((line) => (
                <Row
                  key={line.orderItemId}
                  label={`${line.name} · ${line.qty} ш`}
                  value={money(line.resaleUnitPrice)}
                />
              ))}
              <p className="m-0 text-[12px] leading-5 text-muted">{preview.notice}</p>
            </div>
          )}
        </>
      )}

      {!loading && transfers.length > 0 && (
        <>
          <Divider />
          <div className="flex flex-col gap-2">
            <div className="text-[13px] text-ink-2">Өмнөх шилжүүлэг</div>
            {transfers.map((row) => (
              <p key={row.id} className="m-0 text-[13px] leading-5 text-muted">
                {row.reason}
                {" · "}төлсөн үлдсэн {money(row.paidKeptAmount)}
                {row.wroteOffDebt ? ` · хаасан өр ${money(row.dueClosedAmount)}` : ""}
              </p>
            ))}
          </div>
        </>
      )}

      <div className="flex flex-col gap-2">
        {!loading && eligible.length > 0 && (
          <>
            <Button size="sm" variant="outline" full loading={busy} onClick={() => void runPreview()}>
              Урьдчилан харах
            </Button>
            <Button size="sm" full loading={busy} disabled={!preview} onClick={() => void confirm()}>
              Баталгаажуулах
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" full disabled={busy} onClick={close}>
          Болих
        </Button>
      </div>
    </Card>
  );
}

function ItemCard({ item, children }: { item: TransferItem; children: ReactNode }) {
  const option = formatSelections(item.selections);
  return (
    <div className="flex flex-col gap-3 rounded-[8px] border border-line p-3">
      <div className="min-w-0">
        <div className="text-[14px] leading-5">{item.name}</div>
        <div className="mt-0.5 text-[12px] leading-5 text-ink-2">
          {option ? `${option} · ` : ""}
          {item.availableQty > 0 ? `${item.availableQty} ширхэг` : `${item.qty} ширхэг`}
        </div>
      </div>
      {children}
    </div>
  );
}
