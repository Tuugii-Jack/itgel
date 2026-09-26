"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useEffect, useState } from "react";
import { Empty, ErrorNote, Skeleton } from "@/components/ui";
import { adminApi, ApiError } from "@/lib/api";
import { dayLabel } from "@/lib/format";
import type { AdminBatchDetail, BatchAuditRow } from "@/lib/types";

const NOTE_KIND: Record<string, string> = {
  DAMAGED: "Гэмтэлтэй",
  SHORT: "Дутуу",
  EXCESS: "Илүү",
};

const ACTION_LABEL: Record<string, string> = {
  BATCH_ARRIVAL: "Ирэлт бүртгэсэн",
  ARRIVAL_SMS: "SMS илгээсэн",
  STATUS_CHANGE: "Шат солисон",
  CREATE: "Үүсгэсэн",
  UPDATE: "Зассан",
};

function actorLabel(actor: string) {
  return actor.replace(/^admin:/, "");
}

export function BatchHistoryPanel({ batch }: { batch: AdminBatchDetail }) {
  const [logs, setLogs] = useState<BatchAuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      deferEffect(() => {
        void adminApi
          .batchAudit(batch.id)
          .then((rows) => {
            setLogs(rows);
            setError(null);
          })
          .catch((e) => {
            setError(e instanceof ApiError ? e.message : "Түүх ачаалж чадсангүй.");
          });
      }),
    [batch.id],
  );

  const notes = batch.arrivalNotes ?? [];

  return (
    <div>
      <h2 className="mt-0 mb-2 text-[16px] font-medium">Гэмтэл / зөрүү</h2>
      <p className="mt-0 mb-3 text-[13px] text-muted">
        Эдгээр бүртгэл борлуулах үлдэгдэл, төлбөрт автоматаар нөлөөлөхгүй.
      </p>
      {notes.length === 0 ? (
        <Empty>Гэмтэл, дутуу, илүү бүртгэл алга.</Empty>
      ) : (
        <div className="mb-6 flex flex-col gap-2">
          {notes.map((note) => (
            <div key={note.id} className="rounded-[10px] border border-line px-3 py-2">
              <div className="text-[14px]">
                {NOTE_KIND[note.kind] ?? note.kind} · {note.qty} ш
              </div>
              {note.note && <div className="mt-0.5 text-[13px] text-ink-2">{note.note}</div>}
              <div className="mt-0.5 text-[12px] text-muted">
                {actorLabel(note.actor)} · {dayLabel(note.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-2 text-[16px] font-medium">Үйлдлийн түүх</h2>
      {error && (
        <div className="mb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {logs === null ? (
        <Skeleton className="h-32" />
      ) : logs.length === 0 ? (
        <Empty>Түүх алга.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {logs.map((log) => {
            const after = log.after as {
              reason?: unknown;
              mode?: unknown;
              allocated?: unknown;
              released?: unknown;
              lines?: unknown;
              allocations?: unknown;
            } | null;
            const reason = typeof after?.reason === "string" ? after.reason.trim() : "";
            const lines = Array.isArray(after?.lines) ? after.lines : [];
            const allocations = Array.isArray(after?.allocations) ? after.allocations : [];
            return (
              <div key={log.id} className="rounded-[10px] border border-line px-3 py-2">
                <div className="text-[14px]">{ACTION_LABEL[log.action] ?? log.action}</div>
                {reason ? <div className="mt-0.5 text-[13px] text-ink-2">{reason}</div> : null}
                {log.action === "BATCH_ARRIVAL" && lines.length > 0 && (
                  <div className="mt-1 flex flex-col gap-0.5 text-[13px] text-ink-2">
                    {lines.map((line, i) => {
                      const row = line as {
                        selections?: Record<string, string>;
                        addQty?: number;
                        arrivedQty?: number;
                      };
                      const sel = row.selections
                        ? Object.values(row.selections).filter(Boolean).join(" / ")
                        : "";
                      const add = typeof row.addQty === "number" ? row.addQty : 0;
                      const total = typeof row.arrivedQty === "number" ? row.arrivedQty : null;
                      return (
                        <div key={`${log.id}-line-${i}`}>
                          {sel || "Үндсэн"} · {add > 0 ? `+${add}` : add} ш
                          {total != null ? ` · нийт ${total}` : ""}
                        </div>
                      );
                    })}
                    {typeof after?.allocated === "number" && after.allocated > 0 && (
                      <div className="text-[12px] text-muted">Хуваарилсан {after.allocated} ш</div>
                    )}
                    {allocations.slice(0, 8).map((row, i) => {
                      const a = row as { orderCode?: string; add?: number };
                      if (!a.orderCode || !a.add) return null;
                      return (
                        <div key={`${log.id}-a-${i}`} className="tnum text-[12px] text-muted">
                          {a.orderCode}: +{a.add}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="mt-0.5 text-[12px] text-muted">
                  {actorLabel(log.actor)} · {dayLabel(log.createdAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
