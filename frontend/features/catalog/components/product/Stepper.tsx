"use client";

export function Stepper({
  qty,
  max,
  onChange,
  size = "md",
}: {
  qty: number;
  max: number;
  onChange: (qty: number) => void;
  /** md — мобайлын 44px, lg — дизайны laptop дээрх 48px. */
  size?: "md" | "lg";
}) {
  const box = size === "lg" ? "h-12" : "h-11";
  const key = size === "lg" ? "w-12 text-[18px]" : "w-11 text-[18px]";
  const value = size === "lg" ? "w-10 text-[16px]" : "w-10 text-[15px]";

  return (
    <div
      className={`flex shrink-0 items-center rounded-[8px] border border-line ${box}`}
    >
      <button
        type='button'
        aria-label='Хасах'
        onClick={() => onChange(Math.max(1, qty - 1))}
        className={`h-full cursor-pointer border-0 bg-transparent text-ink disabled:opacity-30 ${key}`}
        disabled={qty <= 1}
      >
        −
      </button>
      <span className={`tnum text-center ${value}`}>{qty}</span>
      <button
        type='button'
        aria-label='Нэмэх'
        onClick={() => onChange(Math.min(max, qty + 1))}
        className={`h-full cursor-pointer border-0 bg-transparent text-ink disabled:opacity-30 ${key}`}
        disabled={qty >= max}
      >
        +
      </button>
    </div>
  );
}
