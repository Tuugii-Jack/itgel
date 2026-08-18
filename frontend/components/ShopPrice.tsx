import type { ReactNode } from "react";

/** Дэлгүүрийн үнэ — барааны үнэ + карго. */
export function ShopPrice({
  children,
  className = "",
  noteClassName = "text-[13px] font-normal text-ink-2",
}: {
  children: ReactNode;
  className?: string;
  noteClassName?: string;
}) {
  return (
    <span className={`inline-flex items-baseline gap-1 ${className}`}>
      <span>{children}</span>
      <span className={noteClassName}>+ карго</span>
    </span>
  );
}
