"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProductImage } from "@/components/ProductImage";
import { Badge, Button, Divider } from "@/components/ui";
import { useCart } from "@/lib/cart";
import { countdown, money } from "@/lib/format";
import type { Product } from "@/lib/types";

/** Дэлгүүрийн барааны карт. */
export function ProductCard({ product }: { product: Product }) {
  const cart = useCart();
  const isOrder = product.type === "order";
  const soldOut =
    product.status === "SOLD_OUT" || (!isOrder && product.stock <= 0);
  const closed = product.status === "CLOSED";
  const needsChoice = (product.options?.length ?? 0) > 0 || product.sizes.length > 0 || product.colors.length > 0;

  return (
    <div className='flex flex-col overflow-hidden rounded-[12px] border border-line bg-bg'>
      <Link href={`/p/${product.id}`} className='relative block no-underline'>
        <div className='relative aspect-square border-b border-line bg-surface'>
          <ProductImage
            src={product.images[0]}
            alt={product.name}
            className='h-full w-full'
          />
          {isOrder && product.closeAt && !closed && (
            <CloseCountdown closeAt={product.closeAt} />
          )}
        </div>
      </Link>

      <div className='flex flex-1 flex-col gap-2 p-3.5'>
        <Badge tone={isOrder ? "neutral" : "ok"} className='self-start'>
          {isOrder ? "Захиалгын бараа" : "Бэлэн бараа"}
        </Badge>

        <Link href={`/p/${product.id}`} className='no-underline'>
          <div className='clamp-2 text-[15px] leading-[1.4] text-ink'>
            {product.name}
          </div>
        </Link>

        <div className='tnum text-[18px] font-medium'>
          {money(product.price)}
        </div>

        {!isOrder && (
          <>
            <Divider className='my-0.5' />
            <CardFact
              label='Үлдэгдэл'
              value={soldOut ? "Дууссан" : `${product.stock} ширхэг`}
              tone={soldOut ? "danger" : "ok"}
            />
          </>
        )}

        <div className='mt-auto pt-1'>
          {closed || soldOut ? (
            <Button full disabled>
              {closed ? "Захиалга хаагдсан" : "Дууссан"}
            </Button>
          ) : needsChoice || isOrder ? (
            <Link href={`/p/${product.id}`} className='no-underline'>
              <Button full>{isOrder ? "Захиалах" : "Сонгох"}</Button>
            </Link>
          ) : (
            <Button
              full
              onClick={() =>
                cart.add({
                  productId: product.id,
                  name: product.name,
                  price: product.price,
                  image: product.images[0] ?? null,
                  type: product.type,
                  selections: {},
                  size: null,
                  color: null,
                  qty: 1,
                  arriveFrom: product.arriveFrom,
                  arriveTo: product.arriveTo,
                  stock: product.stock,
                })
              }
            >
              Сагсанд хийх
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Картын мэдээллийн мөр — шошго дээр, утга доор. */
function CardFact({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "danger";
}) {
  const colors = { neutral: "text-ink", ok: "text-ok", danger: "text-danger" };
  return (
    <div className='leading-[1.35]'>
      <div className='text-[12px] text-muted'>{label}</div>
      <div className={`tnum text-[13px] ${colors[tone]}`}>{value}</div>
    </div>
  );
}

/** Зураг дээрх хугацааны тэмдэглэгээ. */
function CloseCountdown({ closeAt }: { closeAt: string }) {
  const label = useCountdown(closeAt);
  if (!label || label === "Хаагдсан") return null;
  return (
    <div className='absolute inset-x-1.5 bottom-2 flex min-h-[28px] items-center justify-center gap-1 rounded-[6px] border border-line bg-bg/95 px-1.5 py-1 backdrop-blur-sm'>
      <svg
        width='11'
        height='11'
        viewBox='0 0 12 12'
        fill='none'
        stroke='#B45309'
        strokeWidth='1.2'
        strokeLinecap='round'
        className='shrink-0'
      >
        <circle cx='6' cy='6' r='4.6' />
        <path d='M6 3.4 V6 L7.9 7.2' />
      </svg>
      <span className='tnum text-center text-[10px] leading-tight text-warn sm:text-[11px]'>
        {label}
      </span>
    </div>
  );
}

/** Секунд тутам шинэчилнэ — «1 хоног 3 цаг 12 мин 5 сек үлдсэн». */
export function useCountdown(iso: string | null): string {
  // Эхлэхдээ хоосон — сервер ба браузерын цаг зөрж hydration алдаа гаргахгүй.
  const [label, setLabel] = useState("");

  useEffect(() => {
    setLabel(countdown(iso));
    if (!iso) return;
    const timer = setInterval(() => setLabel(countdown(iso)), 1000);
    return () => clearInterval(timer);
  }, [iso]);

  return label;
}
