"use client";

import { useEffect, useState } from "react";
import { Button, Card, Empty } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { phoneLabel } from "@/lib/format";
import { smsStatusLabel, smsToastForSend } from "@/lib/smsStatus";
import { useToast } from "@/lib/toast";
import type { AdminBatchDetail, ArrivalSmsPreview } from "@/lib/types";

export function ArrivalSmsPanel({
  batch,
  onSent,
}: {
  batch: AdminBatchDetail;
  onSent: () => void;
}) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArrivalSmsPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void adminApi
      .previewBatchArrivalSms(batch.id)
      .then((data) => {
        if (!cancelled) {
          setPreview(data);
          setPreviewError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setPreviewError(e instanceof ApiError ? e.message : "Preview ачаалж чадсангүй.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [batch.id, batch.orders.length, batch.stage]);

  const send = async (orderId?: string, resend = false) => {
    const key = orderId ?? "all";
    if (busyId) return;
    setBusyId(key);
    try {
      const result = await adminApi.sendBatchArrivalSms(
        batch.id,
        orderId ? { orderId, resend: resend || undefined } : undefined,
      );
      const fail = result.failed.length;
      if (fail > 0 && result.sent === 0) {
        toast.error(result.failed[0]?.error ?? "Хүргэлт амжилтгүй.");
      } else {
        const note = smsToastForSend({
          sent: result.sent,
          pending: result.pending,
          delivered: result.delivered,
          unknown: result.unknown,
          failed: fail,
        });
        if (note?.kind === "error") toast.error(note.message);
        else if (note) toast.success(note.message);
        else toast.success("Илгээх захиалга алга.");
      }
      setConfirming(false);
      onSent();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "SMS илгээж чадсангүй.");
    } finally {
      setBusyId(null);
    }
  };

  const recipients = preview?.recipients ?? [];
  const skipped = preview?.skipped ?? [];

  return (
    <Card className="mt-4 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-medium">Бараа ирсэн SMS</div>
          <p className="mt-1 mb-0 text-[13px] text-ink-2">
            Зөвхөн бодитоор ирсэн, хуваарилагдсан, олгоогүй захиалгад илгээнэ. Давхар дарахад автоматаар дахин явахгүй.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setConfirming(true)}
          disabled={recipients.length === 0 || busyId !== null}
        >
          Бөөнөөр илгээх ({recipients.length})
        </Button>
      </div>

      {previewError && <div className="mb-3 text-[13px] text-warn">{previewError}</div>}

      {confirming && (
        <div className="mb-3 rounded-[10px] border border-line bg-surface p-3">
          <div className="text-[14px] font-medium">Илгээх preview</div>
          <p className="mt-1 mb-2 text-[13px] text-muted">
            {recipients.length} хүлээн авагч. Агуулга: itgel {"{код}"} бараа ирлээ.
          </p>
          {recipients.slice(0, 8).map((row) => (
            <div key={row.orderId} className="tnum text-[13px] text-ink-2">
              {row.code} · {row.name ?? "Нэргүй"} · {phoneLabel(row.phone)}
            </div>
          ))}
          {recipients.length > 8 && (
            <div className="mt-1 text-[12px] text-muted">+{recipients.length - 8} захиалга</div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
              Болих
            </Button>
            <Button size="sm" onClick={() => void send()} loading={busyId === "all"}>
              Илгээх
            </Button>
          </div>
        </div>
      )}

      {recipients.length === 0 && skipped.length === 0 ? (
        <Empty>SMS илгээх захиалга алга.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {recipients.map((row) => (
            <div
              key={row.orderId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2"
            >
              <div className="min-w-0">
                <div className="tnum text-[14px]">{row.code}</div>
                <div className="truncate text-[13px] text-ink-2">
                  {row.name ?? "Нэргүй"} · {phoneLabel(row.phone)}
                </div>
                <div className="truncate text-[12px] text-muted">{row.text}</div>
              </div>
              <Button
                size="sm"
                onClick={() => void send(row.orderId)}
                loading={busyId === row.orderId}
                disabled={busyId !== null}
              >
                SMS илгээх
              </Button>
            </div>
          ))}
          {skipped.map((row) => {
            const order = batch.orders.find((o) => o.id === row.orderId);
            const statusText = order?.arrivalSmsStatus
              ? smsStatusLabel(order.arrivalSmsStatus, order.arrivalSmsError)
              : "";
            const already = row.reason === "Аль хэдийн илгээсэн";
            return (
              <div
                key={row.orderId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="tnum text-[14px]">{row.code}</div>
                  <div className="truncate text-[13px] text-ink-2">
                    {row.reason}
                    {statusText ? ` · ${statusText}` : ""}
                  </div>
                </div>
                {already && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void send(row.orderId, true)}
                    loading={busyId === row.orderId}
                    disabled={busyId !== null}
                  >
                    Дахин илгээх
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
