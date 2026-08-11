"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useCart } from "@/lib/cart";

/**
 * Laptop дизайны нийтлэг толгой — 68px, 40px хажуугийн зай.
 *
 * Зөвхөн `lg`-ээс дээш харагдана: мобайл дээр дэлгэц бүр өөрийн 48px
 * буцах толгойтой. Нүүр хуудас өөрийн толгойтой тул түүнийг алгасна.
 */
export function ShopHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const cart = useCart();
  const [query, setQuery] = useState("");

  if (pathname === "/") return null;

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/?q=${encodeURIComponent(q)}` : "/");
  };

  return (
    <header className="hidden h-[68px] shrink-0 items-center gap-8 border-b border-line bg-bg px-10 lg:flex">
      <Link href="/" className="shrink-0 text-[20px] font-medium tracking-[-0.01em] no-underline">
        itgel
      </Link>

      <form onSubmit={search} className="flex h-10 max-w-[420px] flex-1 items-center gap-2 rounded-[8px] border border-line bg-surface px-3">
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="#A8A29E" strokeWidth="1.3" strokeLinecap="round" className="shrink-0">
          <circle cx="8" cy="8" r="5.5" />
          <path d="M12.2 12.2 16 16" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Бараа хайх"
          className="h-full w-full bg-transparent text-[14px] outline-none placeholder:text-muted"
        />
      </form>

      <div className="ml-auto flex items-center gap-2">
        <Link
          href="/profile"
          className="flex h-10 items-center gap-2 rounded-[8px] border border-line bg-bg px-3 text-[14px] no-underline"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#57534E" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="5.6" r="2.8" />
            <path d="M2.8 13.6c0-2.6 2.3-4.2 5.2-4.2s5.2 1.6 5.2 4.2" />
          </svg>
          Профайл
        </Link>
        <Link
          href="/cart"
          className="flex h-10 items-center gap-2 rounded-[8px] bg-ink px-3.5 text-[14px] text-white no-underline"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 2.6h1.9l1.7 8h6.8l1.6-6H4.4" />
            <circle cx="6.4" cy="13.2" r="1.1" />
            <circle cx="11.8" cy="13.2" r="1.1" />
          </svg>
          Сагс{cart.lines.length > 0 && ` ${cart.lines.length}`}
        </Link>
      </div>
    </header>
  );
}
