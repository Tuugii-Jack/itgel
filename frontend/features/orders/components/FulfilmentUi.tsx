"use client";

import type { ReactNode } from "react";

export function FulfilmentField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[14px] text-ink-2">{label}</div>
      {children}
    </div>
  );
}

export function FulfilmentRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-2">{label}</span>
      <span className={ok ? "text-ok" : ""}>{value}</span>
    </div>
  );
}

export function FulfilmentOptionCard({
  selected,
  onSelect,
  title,
  right,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  right: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full cursor-pointer gap-3 rounded-[12px] border p-4 text-left
        ${selected ? "border-ink bg-surface" : "border-line bg-bg"}`}
    >
      <span
        className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border bg-bg
          ${selected ? "border-ink" : "border-line"}`}
      >
        {selected && <span className="size-[9px] rounded-full bg-ink" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[17px] text-ink">{title}</span>
          {right}
        </span>
        {children}
      </span>
    </button>
  );
}
