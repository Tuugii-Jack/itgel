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
    api.store().then(setStore).catch(() => {});
  }, []);

  return (
    <header
      className={`sticky top-0 z-30 flex h-24 lg:h-32 xl:h-28 items-center gap-6 lg:gap-10 xl:gap-12 bg-bg/80 backdrop-blur-md mx-auto w-full px-4 sm:px-6 lg:px-10 xl:px-14 transition-transform duration-300 ease-out ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <Link href="/" className="no-underline shrink-0">
        <Image
          src="/logo.webp"
          alt={store?.storeName ?? "itgel"}
          width={48}
          height={48}
          priority
          className="h-10 lg:h-12 xl:h-14 w-auto"
        />
      </Link>

      <nav className="hidden items-center gap-2 lg:gap-4 xl:gap-5 lg:flex">
        <NavLink href="/order" icon="order">
          Захиалгын бараа
        </NavLink>
        <NavLink href="/#ready" icon="ready">
          Бэлэн бараа
        </NavLink>
      </nav>

      <div className="ml-auto flex items-center gap-2 lg:gap-4">
        {store?.phone && (
          <a
            href={`tel:${store.phone.replace(/\D/g, "")}`}
            className="tnum hidden h-10 items-center rounded-[8px] px-3 text-[14px] lg:text-[15px] text-ink-2 no-underline transition-colors hover:text-primary xl:inline-flex lg:h-11 xl:h-12"
          >
            {store.phone}
          </a>
        )}
        <Link href="/profile" className="no-underline">
          <Button
            variant="outline"
            size="sm"
            className="h-10 lg:h-11 xl:h-12 lg:px-5 lg:text-[15px]"
          >
            Профайл
          </Button>
        </Link>
      </div>
    </header>
  );
}

const NAV_ICONS = {
  order: (
    <>
      <path d="M2.5 6h9v8h-9z" />
      <path d="M11.5 9h3.2l2.8 2.8V14h-6z" />
      <circle cx="6" cy="15.3" r="1.6" />
      <circle cx="14.5" cy="15.3" r="1.6" />
    </>
  ),

  ready: (
    <>
      <path d="M3 7.5 10 4l7 3.5-7 3.5-7-3.5z" />
      <path d="M3 7.5v9L10 20l7-3.5v-9" />
      <path d="M10 11v9" />
      <circle cx="15.5" cy="15.5" r="3.6" className="fill-bg" />
      <path d="M13.9 15.5 15 16.6l2.1-2.2" className="stroke-ok" />
    </>
  ),
} as const;

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
    <a
      href={href}
      className="flex items-center gap-2 rounded-[10px] px-4 py-2.5 text-[16px] font-semibold text-ink no-underline transition-colors hover:bg-primary-soft hover:text-primary lg:gap-2.5 lg:px-5 lg:py-3 lg:text-[18px] xl:px-6 xl:py-3.5 xl:text-[19px]"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 lg:h-6 lg:w-6"
        aria-hidden
      >
        {NAV_ICONS[icon]}
      </svg>
      {children}
    </a>
  );
}

/** Доош scroll → нуух, дээш → харуулах. threshold хүртэл бага гүйлгэлтэд нуугдахгүй. */
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
        accum.current = 0;
        setHidden(false);
      } else if (diff > 0) {
        accum.current += diff;
        if (y > threshold && accum.current > threshold) {
          setHidden(true);
        }
      }

      lastY.current = y;
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return hidden;
}