"use client";

import { useEffect, useState } from "react";
import { Button, Card, Empty, ErrorNote, Field, Textarea } from "@/components/ui";
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
  const [commonText, setCommonText] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [composeFor, setComposeFor] = useState<{ orderId?: string; resend?: boolean } | null>(null);

  const refreshPreview = (body?: { commonText?: string }) =>
    adminApi.previewBatchArrivalSms(batch.id, body).then((data) => {
      setPreview(data);
      setPreviewError(null);
      return data;
    });

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
      const live = await refreshPreview(commonText.trim() ? { commonText } : undefined);
      if (!live.previewToken) throw new Error("Preview token алга.");
      const result = await adminApi.sendBatchArrivalSms(batch.id, {
        orderId,
        resend: resend || undefined,
        previewToken: live.previewToken,
        commonText: commonText.trim() || undefined,
        sendKey: crypto.randomUUID(),
      });
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
      setComposeFor(null);
      onSent();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "SMS илгээж чадсангүй.");
    } finally {
      setBusyId(null);
    }
  };

  const recipients = preview?.recipients ?? [];
  const skipped = preview?.skipped ?? [];
  const composeRows = composeFor?.orderId
    ? recipients.filter((row) => row.orderId === composeFor.orderId)
    : recipients;
  const confirmCount = composeFor?.resend ? 1 : composeFor?.orderId ? Math.max(composeRows.length, 0) : recipients.length;

  return (
    <Card className="mt-4 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-medium">Бараа ирсэн SMS</div>
          <p className="mt-1 mb-0 text-[13px] text-ink-2">
            Илгээх товч шууд явуулахгүй. Эцсийн мессежийг хараад батална. Давхар дарахад дахин явахгүй.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setComposeFor({})}
          disabled={recipients.length === 0 || busyId !== null}
        >
          Бөөнөөр илгээх ({recipients.length})
        </Button>
      </div>

      {previewError && <div className="mb-3 text-[13px] text-warn">{previewError}</div>}

      {composeFor && (
        <div className="mb-3 rounded-[10px] border border-line bg-surface p-3">
          <div className="text-[14px] font-medium">Илгээхээс өмнө шалгах</div>
          <p className="mt-1 mb-2 text-[13px] text-muted">
            Суваг: дэлгүүр{preview?.sender ? ` · ${preview.sender}` : ""}. Засвар зөвхөн энэ илгээлтэд.
          </p>
          <Field label="Нийтлэг эх" hint="{code} захиалгын кодоор солигдоно. Хоосон бол үндсэн загвар.">
            <Textarea
              value={commonText}
              onChange={setCommonText}
              rows={3}
              resize="y"
              placeholder="itgel {code} бараа ирлээ."
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => void refreshPreview(commonText.trim() ? { commonText } : undefined).catch((e) => {
              setPreviewError(e instanceof ApiError ? e.message : "Preview ачаалж чадсангүй.");
            })}
          >
            Урьдчилан харах
          </Button>
          <div className="mt-3 flex max-h-48 flex-col gap-2 overflow-y-auto">
            {composeRows.map((row) => (
              <div key={row.orderId} className="rounded-[8px] border border-line px-3 py-2">
                <div className="tnum text-[13px]">
                  {row.code} · {row.name ?? "Нэргүй"} · {phoneLabel(row.phone)}
                </div>
                <div className="mt-1 text-[13px] leading-[1.45] text-ink-2">{row.text}</div>
                <div className="mt-0.5 tnum text-[12px] text-muted">
                  {row.chars ?? [...row.text].length} тэмдэгт
                  {row.segments != null ? ` · ${row.segments} SMS` : ""}
                </div>
              </div>
            ))}
          </div>
          {composeRows.length === 0 && (
            <ErrorNote>Илгээх хүлээн авагч алга. Дахин шалгана уу.</ErrorNote>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setComposeFor(null)} disabled={busyId !== null}>
              Болих
            </Button>
            <Button
              size="sm"
              onClick={() => void send(composeFor.orderId, composeFor.resend)}
              loading={busyId === (composeFor.orderId ?? "all")}
              disabled={confirmCount === 0}
            >
              {confirmCount} дугаарт илгээх
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
                onClick={() => setComposeFor({ orderId: row.orderId })}
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
                    onClick={() => setComposeFor({ orderId: row.orderId, resend: true })}
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
