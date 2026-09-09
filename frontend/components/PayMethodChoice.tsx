"use client";

import {
  DEFAULT_LEASING_CHOICE_HINT,
  DEFAULT_LEASING_TERMS_BODY,
  DEFAULT_LEASING_TERMS_TITLE,
  fillLeasingCopy,
  leasingFeeOf,
  leasingRatePercent,
  type LeasingFeeTier,
} from "@/lib/leasing";
import { money } from "@/lib/format";

/**
 * Сагс болон төлбөрийн самбарт ижил: QPay | Лизинг.
 */
export function PayMethodChoice({
  leasing,
  onChange,
  disabled,
  name = "pay-method",
  subtotal = 0,
  feeTiers,
  choiceHint,
  termsTitle,
  termsBody,
}: {
  leasing: boolean;
  onChange: (leasing: boolean) => void;
  disabled?: boolean;
  name?: string;
  subtotal?: number;
  feeTiers?: LeasingFeeTier[];
  choiceHint?: string;
  termsTitle?: string;
  termsBody?: string;
}) {
  const percent = leasingRatePercent(subtotal, feeTiers);
  const fee = leasingFeeOf(subtotal, feeTiers);
  const vars = { percent, fee, feeText: money(fee) };
  const hint = fillLeasingCopy(choiceHint?.trim() || DEFAULT_LEASING_CHOICE_HINT, vars);
  const title = termsTitle?.trim() || DEFAULT_LEASING_TERMS_TITLE;
  const body = fillLeasingCopy(termsBody?.trim() || DEFAULT_LEASING_TERMS_BODY, vars);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[13px] text-ink-2">Төлбөрийн хэлбэр</div>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-[8px] border border-line px-3 py-2.5">
        <input
          type="radio"
          name={name}
          checked={!leasing}
          disabled={disabled}
          onChange={() => onChange(false)}
          className="mt-1"
        />
        <span>
          <span className="block text-[14px] font-medium">QPay</span>
          <span className="block text-[13px] text-ink-2">
            Барааны үнийг одоо бүрэн төлнө.
          </span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-[8px] border border-line px-3 py-2.5">
        <input
          type="radio"
          name={name}
          checked={leasing}
          disabled={disabled}
          onChange={() => onChange(true)}
          className="mt-1"
        />
        <span>
          <span className="block text-[14px] font-medium">Лизинг</span>
          <span className="block text-[13px] text-ink-2">{hint}</span>
        </span>
      </label>
      {leasing && (
        <div className="rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13px] leading-[1.6] text-ink-2">
          <div className="mb-1 font-medium text-ink">{title}</div>
          {body}
        </div>
      )}
    </div>
  );
}
