"use client";

import { useEffect, useState } from "react";
import { useOnKeyChange } from "@/lib/syncKey";
import { Button, ErrorNote, Textarea } from "@/components/ui";
import { phoneLabel } from "@/lib/format";

export const SMS_SEND_MAX_CHARS = 210;

export function SmsPreviewDialog({
  title,
  name,
  phone,
  defaultText,
  canEdit,
  busy,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  name: string | null;
  phone: string | null;
  defaultText: string;
  canEdit: boolean;
  busy?: boolean;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (text: string) => void;
}) {
  const [text, setText] = useState(defaultText);
  useOnKeyChange(defaultText, () => {
    setText(defaultText);
  });
  const chars = [...text.trim()].length;
  const over = chars > SMS_SEND_MAX_CHARS;
  const empty = text.trim().length === 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="flex w-full max-w-[440px] flex-col rounded-t-[16px] bg-bg sm:rounded-[16px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-4 py-3">
          <div className="text-[16px] font-medium">{title}</div>
          <div className="mt-0.5 text-[13px] text-ink-2">
            {name?.trim() || "Нэргүй"}
            {phone ? ` · ${phoneLabel(phone)}` : ""}
          </div>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4">
          {canEdit ? (
            <>
              <Textarea
                value={text}
                onChange={setText}
                rows={6}
                resize="y"
                className="min-h-[140px] text-[14px] leading-[1.55]"
              />
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className={`tnum ${over ? "text-danger" : "text-muted"}`}>
                  {chars}/{SMS_SEND_MAX_CHARS}
                </span>
                <button
                  type="button"
                  className="cursor-pointer border-0 bg-transparent p-0 text-muted underline"
                  onClick={() => setText(defaultText)}
                >
                  Үндсэн бичвэр
                </button>
              </div>
              <p className="m-0 text-[12px] leading-5 text-muted">
                Энэ хүнд нэг удаа засна. Дараагийн удаа үндсэн загвараар явна.
              </p>
            </>
          ) : (
            <>
              <p className="m-0 rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[14px] leading-[1.55]">
                {defaultText}
              </p>
              <p className="m-0 text-[12px] leading-5 text-muted">
                Энэ хүнд аль хэдийн зассан тул үндсэн загвараар илгээнэ.
              </p>
            </>
          )}
          {over && <ErrorNote>Мессеж {SMS_SEND_MAX_CHARS} тэмдэгтээс хэтрэхгүй.</ErrorNote>}
        </div>
        <div className="flex gap-2 border-t border-line px-4 py-3">
          <Button variant="ghost" full disabled={busy} onClick={onClose}>
            Болих
          </Button>
          <Button
            full
            loading={busy}
            disabled={over || empty || !defaultText}
            onClick={() => onConfirm(canEdit ? text.trim() : defaultText)}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
