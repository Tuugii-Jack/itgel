"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function WorkspaceDialog({ open, onClose, title, children, className = "max-w-[620px]" }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (open && el && !el.open) el.showModal();
    if (!open && el?.open) el.close();
  }, [open]);
  return <dialog ref={dialog} aria-label={title} onCancel={onClose} onClose={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    className={`workspace-dialog fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl border border-line bg-bg p-0 text-ink ${className}`}>
    <div className="flex items-center justify-between border-b border-line px-5 py-4">
      <span className="text-[16px] font-medium">{title}</span>
      <button type="button" aria-label="Хаах" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-surface-2">
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
    {open && children}
  </dialog>;
}
