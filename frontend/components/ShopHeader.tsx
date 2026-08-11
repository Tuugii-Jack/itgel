"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import type { Store } from "@/lib/types";

/**
 * Дэлгүүрийн нийтлэг толгой — нүүр, сагс, профайл гэх мэт бүх хуудсанд ижил.
 * Доош scroll хийхэд нуугдана, дээш гүйлгэхэд буцаж гарна.
 */
export function ShopHeader() {
  const [store, setStore] = useState<Store | null>(null);
  const hidden = useHideOnScroll(500);

  useEffect(() => {
    api.store().then(setStore).catch(() => {});
  }, []);

  return (
    <header
      className={`sticky top-0 z-30 flex h-16 lg:h-20 items-center gap-6 lg:gap-8 bg-bg/80 backdrop-blur-md mx-auto w-full px-4 sm:px-6 lg:px-10 xl:px-14 transition-transform duration-300 ease-out ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <Link href="/" className="no-underline shrink-0">
        <Image
          src="/logo.png"
          alt={store?.storeName ?? "itgel"}
          width={40}
          height={40}
          priority
          className="h-10 lg:h-11 w-auto"
        />
      </Link>

      <nav className="hidden items-center gap-1 lg:flex">
        <NavLink href="/order">Захиалгын бараа</NavLink>
        <NavLink href="/#ready">Бэлэн бараа</NavLink>
      </nav>

      <div className="ml-auto flex items-center gap-2 lg:gap-3">
        {store?.phone && (
          <a
            href={`tel:${store.phone.replace(/\D/g, "")}`}
            className="tnum hidden h-10 items-center rounded-[8px] px-3 text-[14px] text-ink-2 no-underline transition-colors hover:text-primary xl:inline-flex"
          >
            {store.phone}
          </a>
        )}
        <Link href="/profile" className="no-underline">
          <Button variant="outline" size="sm" className="h-10 lg:h-11">
            Профайл
          </Button>
        </Link>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      className="rounded-[8px] px-3 py-2 text-[14px] text-ink-2 no-underline transition-colors hover:bg-primary-soft hover:text-primary"
    >
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
