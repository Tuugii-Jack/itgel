import type { ReactNode } from "react";

/** Дэлгүүрийн үнэ — барааны үнэ дээр карго нэмэгдэнэ. */
export function ShopPrice({
  children,
  className = "",
  noteClassName = "text-[13px] font-normal text-muted",
}: {
  children: ReactNode;
  className?: string;
  noteClassName?: string;
}) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span>{children}</span>
      <span className={noteClassName}>+ карго</span>
    </span>
  );
}
