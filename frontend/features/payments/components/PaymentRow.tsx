"use client";

export function PaymentRow({
  label,
  value,
  big,
}: {
  label: string;
  value: string;
  big?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[13px] text-muted">{label}</span>
      <span
        className={`tnum min-w-0 text-right break-all ${big ? "text-[22px] font-medium" : "text-[15px]"}`}
      >
        {value}
      </span>
    </div>
  );
}
