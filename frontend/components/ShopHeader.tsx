"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import type { Store } from "@/lib/types";

export function ShopHeader() {
  const [store, setStore] = useState<Store | null>(null);
  const hidden = useHideOnScroll(500);

  useEffect(() => {
    api
      .store()
      .then(setStore)
      .catch(() => {});
  }, []);

  return (
    <header
      className={`sticky top-0 z-30 flex h-24 items-center gap-4 border-b border-[#2a2a65]/[0.06] bg-bg/80 px-4 backdrop-blur-md transition-transform duration-300 ease-out sm:px-6 lg:h-32 lg:gap-10 lg:px-10 xl:h-28 xl:gap-12 xl:px-14 ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      {/* Logo + Brand */}
      <Link
        href='/'
        aria-label='Итгэл - Үндсэн хуудас'
        className='group flex shrink-0 items-center gap-1.5 no-underline lg:gap-2'
      >
        <span className='relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] transition-transform duration-300 ease-out group-hover:scale-105 sm:h-14 sm:w-14 lg:h-16 lg:w-16 xl:h-[68px] xl:w-[68px]'>
          <Image
            src='/logo.webp'
            alt={store?.storeName ?? "Итгэл"}
            width={68}
            height={68}
            priority
            className='h-full w-full object-contain'
          />
        </span>

        <span className='flex flex-col justify-center items-center leading-tight'>
          <span className='text-[20px] font-extrabold tracking-tight text-[#2a2a65] transition-colors duration-300 group-hover:text-primary lg:text-[24px] xl:text-[26px]'>
            Итгэл
          </span>

          <span className='flex items-center gap-1 text-[10px] font-medium text-ink-2 sm:gap-1.5 sm:text-[11px] lg:text-[12.5px] xl:text-[13px]'>
            Үйлдвэрийн үнээр
          </span>
        </span>
      </Link>

      {/* Navigation */}
      <nav className='hidden items-center gap-1 lg:flex lg:gap-2 xl:gap-3'>
        <NavLink href='/order' icon='order'>
          Захиалгын бараа
        </NavLink>

        <NavLink href='/#ready' icon='ready'>
          Бэлэн бараа
        </NavLink>
      </nav>

      {/* Right side */}
      <div className='ml-auto flex items-center gap-2 lg:gap-4'>
        {store?.phone && (
          <a
            href={`tel:${store.phone.replace(/\D/g, "")}`}
            className='tnum hidden h-10 items-center rounded-[8px] px-3 text-[14px] text-ink-2 no-underline transition-colors hover:text-primary lg:h-11 lg:text-[15px] xl:inline-flex xl:h-12'
          >
            {store.phone}
          </a>
        )}

        <Link href='/profile' className='no-underline'>
          <Button
            variant='outline'
            size='sm'
            className='h-10 border-[#2a2a65]/20 text-[#2a2a65] hover:border-primary hover:bg-primary/[0.08] hover:text-primary lg:h-11 lg:px-5 lg:text-[15px] xl:h-12'
          >
            Профайл
          </Button>
        </Link>
      </div>
    </header>
  );
}

/* =========================================================
   NAVIGATION ICONS
========================================================= */

const NAV_ICONS = {
  order: (
    <>
      <path d='M2.5 6h9v8h-9z' />
      <path d='M11.5 9h3.2l2.8 2.8V14h-6z' />
      <circle cx='6' cy='15.3' r='1.6' />
      <circle cx='14.5' cy='15.3' r='1.6' />
    </>
  ),

  ready: (
    <>
      <path d='M3 7.5 10 4l7 3.5-7 3.5-7-3.5z' />
      <path d='M3 7.5v9L10 20l7-3.5v-9' />
      <path d='M10 11v9' />
      <circle cx='15.5' cy='15.5' r='3.6' className='fill-bg' />
      <path d='M13.9 15.5 15 16.6l2.1-2.2' className='stroke-ok' />
    </>
  ),
} as const;

/* =========================================================
   NAV LINK
========================================================= */

function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: keyof typeof NAV_ICONS;
  children: string;
}) {
  return (
    <Link
      href={href}
      className='flex items-center gap-2 rounded-[10px] px-4 py-2.5 text-[16px] font-semibold text-ink no-underline transition-colors hover:bg-primary-soft hover:text-primary lg:gap-2.5 lg:px-5 lg:py-3 lg:text-[18px] xl:px-6 xl:py-3.5 xl:text-[19px]'
    >
      <svg
        width='22'
        height='22'
        viewBox='0 0 20 20'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
        className='shrink-0 lg:h-6 lg:w-6'
        aria-hidden='true'
      >
        {NAV_ICONS[icon]}
      </svg>

      {children}
    </Link>
  );
}

/**
 * Доош scroll → нуух
 * Дээш scroll → харуулах
 *
 * threshold хүртэл бага гүйлгэлтэд нуугдахгүй.
 */
function useHideOnScroll(threshold = 500) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const accum = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;

    const onScroll = () => {
      const y = window.scrollY;
      const diff = y - lastY.current;

      if (diff < 0) {
        // Дээш гүйлгэвэл шууд харуулна
        accum.current = 0;
        setHidden(false);
      } else if (diff > 0) {
        // Доош гүйлгэх
        accum.current += diff;

        if (y > threshold && accum.current > threshold) {
          setHidden(true);
        }
      }

      lastY.current = y;
    };

    window.addEventListener("scroll", onScroll, {
      passive: true,
    });

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, [threshold]);

  return hidden;
}
