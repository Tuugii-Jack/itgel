"use client";

import { Button } from "@/components/ui";
import { money } from "@/lib/format";
import type { PublicOrder } from "@/lib/types";
import { FulfilmentRow } from "./FulfilmentUi";

export function FulfilmentSummary({
  order,
  type,
  selectedCount,
  allCargo,
  cargoDue,
  needsCargoPay,
  submitLabel,
  busy,
  onSubmit,
}: {
  order: PublicOrder;
  type: "PICKUP" | "DELIVERY";
  selectedCount: number;
  allCargo: number;
  cargoDue: number;
  needsCargoPay: boolean;
  submitLabel: string;
  busy: boolean;
  onSubmit: () => void;
}) {
  const netPaid = order.paidAmount - order.refundedAmount;
  const goodsPaid = order.subtotal <= netPaid;

  return (
    <>
      <div className="px-4 pb-6 pt-6 lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-4 lg:rounded-[12px] lg:border lg:border-line lg:p-6">
        <div className="hidden text-[17px] font-medium lg:block">Хураангуй</div>
        <div className="tnum flex flex-col gap-2.5 rounded-[12px] border border-line p-3.5 text-[14px] lg:rounded-none lg:border-0 lg:p-0">
          <FulfilmentRow label="Одоо авах" value={`${selectedCount} бараа`} />
          <FulfilmentRow
            label="Барааны төлбөр"
            value={goodsPaid ? "Төлөгдсөн" : money(Math.max(0, order.subtotal - netPaid))}
            ok={goodsPaid}
          />
          {allCargo > 0 && (
            <FulfilmentRow
              label="Карго"
              value={
                type === "PICKUP"
                  ? cargoDue > 0
                    ? `${money(cargoDue)} · дэлгүүрт`
                    : "Төлсөн"
                  : cargoDue > 0
                    ? money(cargoDue)
                    : "Төлсөн"
              }
              ok={cargoDue <= 0}
            />
          )}
          {type === "PICKUP" && (order.storageFee ?? 0) > 0 && (
            <FulfilmentRow label="Агуулахын хураамж" value={money(order.storageFee)} />
          )}
          {type === "DELIVERY" && (
            <div className="text-[13px] leading-[1.45] text-ink-2">
              Хүргэлтийн төлбөрийг хүргэлтийн компани өөрөө авна.
            </div>
          )}
          {needsCargoPay && (
            <>
              <div className="h-px bg-line" />
              <div className="flex justify-between gap-3 text-[17px] font-medium lg:text-[20px]">
                <span>QPay-ээр төлөх</span>
                <span>{money(cargoDue)}</span>
              </div>
            </>
          )}
        </div>

        <div className="hidden lg:block">
          <Button full size="bar" onClick={onSubmit} loading={busy} disabled={selectedCount === 0}>
            {submitLabel}
          </Button>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-[560px] border-t border-line bg-bg px-4 py-3 lg:hidden">
        <Button full size="bar" onClick={onSubmit} loading={busy} disabled={selectedCount === 0}>
          {submitLabel}
        </Button>
      </div>
    </>
  );
}
