"use client";

import { LeasingPaySchedule } from "@/components/LeasingPaySchedule";
import { Button } from "@/components/ui";
import {
  DEFAULT_LEASING_CHOICE_HINT,
  LEGACY_LEASING_CHOICE_HINT,
  DEFAULT_LEASING_TERMS_BODY,
  DEFAULT_LEASING_TERMS_TITLE,
  buildLeasingPayPlan,
  fillLeasingCopy,
  leasingFeeOf,
  leasingRatePercent,
  type LeasingFeeTier,
} from "@/lib/leasing";
import { money } from "@/lib/format";
import type { LeasingPayPlan } from "@/lib/types";

/**
 * Checkout: QPay/Лизинг үйлдлийн товч. Төлбөрийн самбар: сонгосон хэлбэрийн тайлбар.
 */
export function PayMethodChoice({
  leasing,
  onChange,
  disabled,
  loading,
  subtotal = 0,
  feeTiers,
  payGaps,
  payPlan,
  choiceHint,
  termsTitle,
  termsBody,
  compact,
  locked,
}: {
  leasing: boolean | null;
  onChange?: (leasing: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  subtotal?: number;
  feeTiers?: LeasingFeeTier[];
  payGaps?: number[];
  payPlan?: LeasingPayPlan | null;
  choiceHint?: string;
  termsTitle?: string;
  termsBody?: string;
  compact?: boolean;
  locked?: boolean;
}) {
  const percent = leasingRatePercent(subtotal, feeTiers);
  const fee = leasingFeeOf(subtotal, feeTiers);
  const vars = { percent, fee, feeText: money(fee) };
  const storedHint = choiceHint?.trim() || "";
  const hint = fillLeasingCopy(
    !storedHint || storedHint === LEGACY_LEASING_CHOICE_HINT
      ? DEFAULT_LEASING_CHOICE_HINT
      : storedHint,
    vars,
  );
  const chosenLeasing = Boolean(leasing);
  const title = termsTitle?.trim() || DEFAULT_LEASING_TERMS_TITLE;
  const body = fillLeasingCopy(termsBody?.trim() || DEFAULT_LEASING_TERMS_BODY, vars);
  const showLeasingPreview = !locked && !compact && subtotal > 0;
  const plan =
    showLeasingPreview
      ? payPlan ??
        buildLeasingPayPlan({
          isLeasing: true,
          subtotal,
          leasingFee: fee,
          paidAmount: 0,
          refundedAmount: 0,
          payGaps,
        })
      : null;
  const busy = Boolean(disabled || loading);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] text-ink-2">Төлбөрийн хэлбэр</div>
      {locked ? (
        <p className="m-0 text-[14px] leading-[1.5] text-ink-2">
          {chosenLeasing ? (
            <>
              Сонгосон: <span className="font-medium text-ink">Лизинг</span>. {hint}
            </>
          ) : (
            <>
              Сонгосон: <span className="font-medium text-ink">QPay</span>. Барааны үнийг
              одоо бүрэн төлнө.
            </>
          )}
        </p>
      ) : (
        <>
          {showLeasingPreview && (
            <div className="flex flex-col gap-2">
              <div className="rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13px] leading-[1.6] text-ink-2">
                <div className="mb-1 font-medium text-ink">{title}</div>
                {body}
              </div>
              {plan && <LeasingPaySchedule plan={plan} />}
            </div>
          )}
          <p className="m-0 text-[13px] leading-[1.5] text-ink-2">
            Барааны үнийг одоо бүрэн төлнө.
          </p>
          <Button
            full
            size="bar"
            disabled={busy}
            loading={loading}
            onClick={() => onChange?.(false)}
          >
            QPay-ээр төлөх
          </Button>
          <p className="m-0 text-[13px] leading-[1.5] text-ink-2">{hint}</p>
          <Button
            full
            size="bar"
            variant="outline"
            disabled={busy}
            loading={loading}
            onClick={() => onChange?.(true)}
          >
            Лизингээр авах
          </Button>
        </>
      )}
    </div>
  );
}
