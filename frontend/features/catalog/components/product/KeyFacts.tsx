import type { ReactNode } from "react";
import type { Product } from "@/lib/types";

/**
 * Худалдан авах шийдвэрт нөлөөлдөг зүйлс — хэзээ гартаа авах, хэзээ хаагдах,
 * хэдэн ширхэг үлдсэн. Эдгээрийг хайж олох биш, шууд харагдах ёстой.
 */
export function KeyFacts({
  product,
  closeLabel,
  soldOut,
  closed,
}: {
  product: Product;
  closeLabel: string;
  soldOut: boolean;
  closed: boolean;
}) {
  const isOrder = product.type === "order";

  // Laptop дээр эдгээр нь зурган дээрх шошго болж хуваагдана.
  return (
    <div className='lg:hidden'>
      <div className='divide-y divide-line rounded-[12px] border border-line'>
        {isOrder && !closed && closeLabel && (
          <Fact
            icon='clock'
            label='Захиалга хаагдах'
            value={closeLabel}
            tone='warn'
          />
        )}

        {!isOrder && (
          <Fact
            icon='box'
            label='Үлдэгдэл'
            value={soldOut ? "Дууссан" : `${product.stock} ширхэг`}
            tone={soldOut ? "danger" : "ok"}
          />
        )}
      </div>
    </div>
  );
}

export const FACT_ICONS: Record<string, ReactNode> = {
  truck: (
    <path d='M1.5 5h7v6h-7zM8.5 8h2.5l1.5 2v1h-4zM3.3 12.3a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6zM9.7 12.3a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z' />
  ),
  clock: (
    <>
      <circle cx='7' cy='7' r='5.5' />
      <path d='M7 4v3l2 1.2' />
    </>
  ),
  box: (
    <>
      <path d='M1.5 4.5 7 2l5.5 2.5L7 7 1.5 4.5z' />
      <path d='M1.5 4.5v5.2L7 12l5.5-2.3V4.5' />
      <path d='M7 7v5' />
    </>
  ),
  card: (
    <>
      <rect x='1.5' y='3' width='11' height='8' rx='1.2' />
      <path d='M1.5 5.5h11' />
    </>
  ),
};

function Fact({
  icon,
  label,
  value,
  strong,
  tone = "neutral",
}: {
  icon: keyof typeof FACT_ICONS;
  label: string;
  value: string;
  strong?: boolean;
  tone?: "neutral" | "ok" | "warn" | "danger";
}) {
  const colors = {
    neutral: "text-ink",
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
  };
  const iconColors = {
    neutral: "text-ink-2",
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
  };

  const glyph = (
    <svg
      width={strong ? 16 : 14}
      height={strong ? 16 : 14}
      viewBox='0 0 14 14'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.2'
      strokeLinecap='round'
      strokeLinejoin='round'
      className={`shrink-0 ${iconColors[tone]}`}
      aria-hidden
    >
      {FACT_ICONS[icon]}
    </svg>
  );

  // Гарт очих огноо урт байдаг тул шошгыг дээр нь тавьж, тасрахаас сэргийлнэ.
  if (strong) {
    return (
      <div className='flex items-start gap-2.5 px-4 py-3.5'>
        <span className='mt-[3px]'>{glyph}</span>
        <div>
          <div className='text-[13px] text-ink-2'>{label}</div>
          <div
            className={`tnum text-[19px] font-medium leading-tight ${colors[tone]}`}
          >
            {value}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='flex items-center justify-between gap-3 px-4 py-3'>
      <span className='flex items-center gap-2 text-[14px] text-ink-2'>
        {glyph}
        {label}
      </span>
      <span className={`tnum text-right text-[15px] ${colors[tone]}`}>
        {value}
      </span>
    </div>
  );
}
