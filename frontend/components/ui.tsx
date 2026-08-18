"use client";

import type { KeyboardEventHandler, ReactNode } from "react";

/*
 * Дизайн системийн үндсэн элементүүд.
 * Сүүдэр, градиент хэрэглэхгүй — зөвхөн 1px хүрээ.
 * Товч, оролтын өндөр 44px минимум.
 * Интерактив/сонгогдсон төлөв → brand primary (лого цэнхэр). Энгийн текст → ink хэвээр.
 */

export function Card({
  children,
  className = "",
  surface = false,
}: {
  children: ReactNode;
  className?: string;
  surface?: boolean;
}) {
  return (
    <div
      className={`rounded-[12px] border border-line ${surface ? "bg-surface" : "bg-bg"} ${className}`}
    >
      {children}
    </div>
  );
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "md" | "bar" | "lg" | "sm";
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  className?: string;
};

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  size = "md",
  disabled,
  loading,
  full,
  className = "",
}: ButtonProps) {
  // `bar` — дизайны үндсэн CTA (сагс, ирсэн, амжилттай) 48px өндөртэй.
  const heights = {
    sm: "h-9 px-3 text-[13px]",
    md: "h-11 px-4",
    bar: "h-12 px-5 text-[15px]",
    lg: "h-14 px-5 text-[15px]",
  };
  const variants = {
    primary:
      "bg-primary text-white border border-primary hover:bg-primary-dark hover:border-primary-dark transition-colors",
    outline:
      "bg-bg text-ink border border-line hover:border-primary-muted hover:text-primary transition-colors",
    ghost: "bg-transparent text-ink-2 border border-transparent",
    danger: "bg-bg text-danger border border-line",
  };
  // Ачаалж байхад товч «үхсэн» мэт бүдгэрэхгүй — spinner эргэлдэж,
  // өнгө нь хэвээр үлдэнэ. Зөвхөн жинхэнэ disabled үед л бүдгэрнэ.
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-[8px] leading-tight
        ${heights[size]} ${variants[variant]} ${full ? "w-full" : ""}
        ${loading ? "opacity-90" : disabled ? "opacity-40" : "cursor-pointer active:opacity-80"} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`spin inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

/** Ачаалж буй агуулгын оронд харагдах саарал хэлбэр — хоосон дэлгэцээс дээр. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`shimmer rounded-[8px] bg-surface-2 ${className}`}
    />
  );
}

export type Tone = "neutral" | "ok" | "warn" | "info" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  info: "bg-info-bg text-info",
  danger: "bg-danger-bg text-danger",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-[6px] px-2 py-0.5 text-[12px] leading-5 ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Зүүн талд шошго, баруун талд утга — картын мэдээллийн мөр. */
export function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
}) {
  const colors: Record<Tone, string> = {
    neutral: "text-ink",
    ok: "text-ok",
    warn: "text-warn",
    info: "text-info",
    danger: "text-danger",
  };
  return (
    <div className='flex items-baseline justify-between gap-2 text-[13px]'>
      <span className='shrink-0 text-muted'>{label}</span>
      <span className={`tnum text-right ${colors[tone ?? "neutral"]}`}>
        {value}
      </span>
    </div>
  );
}

export function Divider({ className = "" }: { className?: string }) {
  return <div className={`h-px bg-line ${className}`} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label?: string;
  hint?: string;
  children: ReactNode;
}) {
  const normalizedHint = hint?.trim();
  const visibleHint =
    normalizedHint && normalizedHint !== "Заавал биш"
      ? normalizedHint
      : undefined;

  return (
    <label className='flex flex-col gap-1.5'>
      {label && <span className='text-[13px] text-ink-2'>{label}</span>}
      {children}
      {visibleHint && (
        <span className='text-[12px] text-muted'>{visibleHint}</span>
      )}
    </label>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  maxLength,
  disabled,
  className = "",
  autoFocus,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "numeric" | "text" | "tel" | "email" | "decimal";
  maxLength?: number;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      maxLength={maxLength}
      disabled={disabled}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      className={`h-11 w-full rounded-[8px] border border-line bg-bg px-3 text-[15px]
        placeholder:text-muted disabled:bg-surface ${className}`}
    />
  );
}

export function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className='w-full resize-none rounded-[8px] border border-line bg-bg p-3 text-[15px] leading-[1.6] placeholder:text-muted'
    />
  );
}

/** Dropdown биш — том товч хэлбэрийн сонголт. */
export function ChoiceGroup({
  options,
  value,
  onChange,
  columns,
}: {
  options: { value: string; label: string; disabled?: boolean; note?: string }[];
  value: string | null;
  onChange: (value: string) => void;
  columns?: number;
}) {
  return (
    <div
      className={columns ? "grid gap-2" : "flex flex-wrap gap-2"}
      style={
        columns
          ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
          : undefined
      }
    >
      {options.map((option) => {
        const disabled = Boolean(option.disabled);
        const active = option.value === value && !disabled;
        return (
          <button
            key={option.value}
            type='button'
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`min-h-11 rounded-[8px] border px-3 py-1.5 text-[14px] leading-tight transition-colors
              ${
                disabled
                  ? "cursor-not-allowed border-line bg-surface text-muted"
                  : active
                    ? "border-primary bg-primary text-white"
                    : "cursor-pointer border-line bg-bg text-ink hover:border-primary-muted"
              }
              ${columns ? "" : "min-w-11"}`}
          >
            <span className="flex flex-col items-center justify-center">
              <span>{option.label}</span>
              {option.note && (
                <span className={`text-[11px] ${disabled ? "text-danger" : active ? "text-white/80" : "text-muted"}`}>
                  {option.note}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className='flex items-center justify-between gap-3 py-1'>
      <div className='min-w-0'>
        <div className='text-[14px]'>{label}</div>
        {hint && <div className='text-[13px] text-muted'>{hint}</div>}
      </div>
      <button
        type='button'
        role='switch'
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors
          ${checked ? "border-primary bg-primary" : "border-line bg-surface-2"}
          ${disabled ? "opacity-50" : "cursor-pointer"}`}
      >
        <span
          className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white transition-all
            ${checked ? "left-[22px]" : "left-0.5"}`}
          style={{ height: 18, width: 18 }}
        />
      </button>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className='px-6 py-12 text-center text-[15px] text-ink-2'>
      {children}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className='rounded-[8px] border border-line bg-danger-bg px-3 py-2.5 text-[13px] text-danger'>
      {children}
    </div>
  );
}

/** Барааны зураггүй үед — нимгэн шугаман placeholder. */
export function ImagePlaceholder({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center bg-surface ${className}`}>
      <svg viewBox='0 0 100 100' className='h-1/2 w-1/2' aria-hidden>
        <g
          fill='none'
          stroke='#A8A29E'
          strokeWidth='1.4'
          strokeLinecap='round'
          strokeLinejoin='round'
        >
          <rect x='18' y='26' width='64' height='48' rx='4' />
          <path d='M18 60 L36 44 L52 60 L62 52 L82 68' />
          <circle cx='62' cy='40' r='5' />
        </g>
      </svg>
    </div>
  );
}
