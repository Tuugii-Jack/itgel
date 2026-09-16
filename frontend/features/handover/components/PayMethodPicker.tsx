"use client";

import { money } from "@/lib/format";
import type { HandoverPayMethod } from "@/lib/types";

export function PayMethodPicker({
  amount,
  value,
  onChange,
}: {
  amount: number;
  value: HandoverPayMethod | null;
  onChange: (v: HandoverPayMethod) => void;
}) {
  return (
    <div className="border-t border-line bg-warn-bg px-4 py-3">
      <div className="mb-2 text-[13px] text-ink-2">
        <span className="tnum font-medium text-ink">{money(amount)}</span>-ийг яаж авсан бэ
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { id: "CASH", label: "Бэлэн" },
            { id: "CARD", label: "Карт" },
            { id: "BANK_TRANSFER", label: "Данс" },
          ] as const
        ).map((opt) => {
          const on = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={`h-11 cursor-pointer rounded-[8px] border text-[14px] font-medium ${
                on ? "border-ink bg-ink text-white" : "border-line bg-bg text-ink"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
