"use client";

import { money } from "@/lib/format";
import { formatSelections } from "@/lib/options";
import { ITEM_FULFILMENT_LABEL } from "@/lib/fulfilment";
import type { PublicOrder } from "@/lib/types";
import { lineCargo } from "../lib/cargo";

export function FulfilmentItemRow({
  item,
  mode,
  checked,
  onToggle,
}: {
  item: PublicOrder["items"][number];
  mode: "check" | "locked" | "waiting";
  checked?: boolean;
  onToggle?: () => void;
}) {
  const sel = formatSelections(item.selections, item.size, item.color);
  const arrived = mode !== "waiting";
  const qtyLabel =
    arrived && (item.arrivedQty ?? item.qty) < item.qty
      ? `${item.arrivedQty}/${item.qty} ш`
      : `${item.qty} ш`;
  const cargo = lineCargo(item);
  const method = item.fulfilment ? ITEM_FULFILMENT_LABEL[item.fulfilment] : null;
  const extra =
    mode === "waiting"
      ? " · хүлээж байна"
      : method
        ? ` · ${method}`
        : cargo > 0
          ? ` · карго ${money(cargo)}`
          : "";

  const body = (
    <>
      {mode === "check" ? (
        <input
          type="checkbox"
          className="size-5 shrink-0 accent-ink"
          checked={Boolean(checked)}
          onChange={onToggle}
        />
      ) : mode === "locked" ? (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-[4px] border border-line bg-surface">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted"
          >
            <path d="M2.5 6.2 L4.8 8.5 L9.5 3.5" />
          </svg>
        </span>
      ) : (
        <span className="size-5 shrink-0 rounded-[4px] border border-line bg-surface" />
      )}
      <span className="min-w-0 flex-1">
        <span className={`block text-[14px] ${arrived ? "" : "text-ink-2"}`}>{item.name}</span>
        <span className="block text-[13px] text-muted">
          {sel}
          {sel ? " · " : ""}
          {qtyLabel}
          {extra}
        </span>
      </span>
      <span className="tnum shrink-0 text-[14px]">{money(item.total)}</span>
    </>
  );

  if (mode === "check") {
    return (
      <label className="flex w-full cursor-pointer items-center gap-3 border-b border-line p-3.5 text-left last:border-b-0">
        {body}
      </label>
    );
  }

  return (
    <div className="flex items-center gap-3 border-b border-line p-3.5 last:border-b-0">{body}</div>
  );
}
