"use client";

import { Button } from "@/components/ui";
import { money } from "@/lib/format";

/**
 * Доод үйлдлийн мөр — sidebar-ийн баруун талд, дүн урт байсан ч эвдрэхгүй.
 * Үндсэн CTA дээр, хэвлэх доор (бүтэн өргөн).
 */
export function HandoverActionBar({
  maxWidth,
  printDisabled,
  onPrint,
  primaryLabel,
  primaryAmount,
  primarySub,
  primaryDisabled,
  primaryLoading,
  onPrimary,
}: {
  maxWidth: string;
  printDisabled?: boolean;
  onPrint: () => void;
  primaryLabel: string;
  primaryAmount?: number | null;
  primarySub?: string;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  onPrimary: () => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 lg:left-[220px]">
      <div
        className="pointer-events-auto mx-auto border-t border-line bg-bg px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        style={{ maxWidth }}
      >
        <div className="flex flex-col gap-2">
          <Button
            full
            size="lg"
            loading={primaryLoading}
            disabled={primaryDisabled}
            onClick={onPrimary}
            className="h-14"
          >
            {primaryAmount != null && primaryAmount > 0 ? (
              <span className="flex flex-col items-center leading-tight">
                <span className="tnum text-[17px] font-medium">{money(primaryAmount)}</span>
                <span className="text-[12px] font-normal opacity-90">
                  {primarySub ?? "авч, хүлээлгэн өгөх"}
                </span>
              </span>
            ) : (
              primaryLabel
            )}
          </Button>
          <Button
            full
            variant="outline"
            size="bar"
            disabled={printDisabled}
            onClick={onPrint}
          >
            Баримт хэвлэх
          </Button>
        </div>
      </div>
    </div>
  );
}
