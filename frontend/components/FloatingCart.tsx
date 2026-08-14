"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/lib/cart";
import { money } from "@/lib/format";

/**
 * Дэлгүүрийн бүх хуудсанд баруун доор дагадаг сагс.
 * Сагсны хуудас болон амжилттай захиалгын дээр нуугдана.
 * Барааны хуудасны мобайл CTA-ийн дээр сууна.
 */
export function FloatingCart() {
  const cart = useCart();
  const pathname = usePathname();
  const prevCount = useRef(cart.count);
  const [bump, setBump] = useState(false);

  useEffect(() => {
    if (cart.count > prevCount.current) {
      setBump(true);
      const t = window.setTimeout(() => setBump(false), 420);
      prevCount.current = cart.count;
      return () => window.clearTimeout(t);
    }
    prevCount.current = cart.count;
  }, [cart.count]);

  if (!cart.ready || cart.count === 0) return null;
  if (pathname === "/cart" || pathname.startsWith("/success")) return null;

  const onProduct = pathname.startsWith("/p/");

  return (
    <div
      className={`fixed right-4 z-40 md:right-6 ${
        onProduct
          ? "bottom-[calc(5.75rem+env(safe-area-inset-bottom))] lg:bottom-6"
          : "bottom-[calc(1rem+env(safe-area-inset-bottom))] md:bottom-6"
      }`}
    >
      <Link
        href='/cart'
        aria-label={`Сагс · ${cart.count} бараа · ${money(cart.subtotal)}`}
        className={`flex items-center gap-3 rounded-[12px] border border-primary bg-primary px-3.5 py-2.5 text-white no-underline transition-transform duration-200 ${
          bump ? "cart-bump" : ""
        }`}
      >
        <span className='relative shrink-0'>
          <svg
            width='22'
            height='22'
            viewBox='0 0 22 22'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.6'
            strokeLinecap='round'
            strokeLinejoin='round'
            aria-hidden
          >
            <path d='M3.5 5.5h1.4l1.3 9.2h10.4l1.5-6.8H6.2' />
            <circle cx='9' cy='17.4' r='1.15' />
            <circle cx='15.6' cy='17.4' r='1.15' />
          </svg>
          <span className='tnum absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-medium leading-none text-primary'>
            {cart.count}
          </span>
        </span>
        <span className='flex min-w-0 flex-col leading-tight'>
          <span className='text-[11px] text-white/80'>Сагс</span>
          <span className='tnum text-[14px] font-medium'>{money(cart.subtotal)}</span>
        </span>
      </Link>
    </div>
  );
}
