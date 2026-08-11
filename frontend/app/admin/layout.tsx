"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Spinner } from "@/components/ui";
import { AdminSessionProvider, useAdminSession } from "@/lib/admin-session";

/**
 * Цэс — ажлын урсгалын дагуу бүлэглэсэн:
 * захиалга авах → багцлах → каталог удирдах → харилцагч → тайлан.
 */
const NAV_GROUPS: { label: string; items: { href: string; label: string }[] }[] = [
  {
    label: "Захиалга",
    items: [
      { href: "/admin", label: "Захиалга" },
      { href: "/admin/handover", label: "Хүлээлгэн өгөх" },
      { href: "/admin/deliveries", label: "Хүргэлт" },
    ],
  },
  {
    label: "Багц",
    items: [{ href: "/admin/batches", label: "Ачааны багц" }],
  },
  {
    label: "Каталог",
    items: [
      { href: "/admin/products", label: "Бараа" },
      { href: "/admin/preorders", label: "Урьдчилсан захиалга" },
      { href: "/admin/ready", label: "Бэлэн бараа" },
      { href: "/admin/storefront", label: "Дэлгүүр" },
      { href: "/admin/categories", label: "Ангилал" },
      { href: "/admin/ads", label: "Зар" },
    ],
  },
  {
    label: "Харилцагч",
    items: [{ href: "/admin/customers", label: "Хэрэглэгчид" }],
  },
  {
    label: "Тайлан",
    items: [
      { href: "/admin/reports", label: "Тайлан" },
      { href: "/admin/archive", label: "Архив" },
    ],
  },
  {
    label: "Тохиргоо",
    items: [{ href: "/admin/settings", label: "Тохиргоо" }],
  },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminSessionProvider>
      <Shell>{children}</Shell>
    </AdminSessionProvider>
  );
}

function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="mb-1 px-3 text-[11px] font-medium tracking-wide text-muted uppercase">
            {group.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={`rounded-[8px] px-3 py-2 text-[14px] no-underline transition-colors
                    ${active ? "bg-ink font-medium text-white" : "text-ink-2 hover:bg-surface-2"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/admin"
      className={`flex items-center no-underline ${compact ? "gap-2" : "gap-2.5"}`}
    >
      <Image
        src="/logo.png"
        alt="итгэл"
        width={compact ? 32 : 36}
        height={compact ? 32 : 36}
        priority
        className={`w-auto ${compact ? "h-8" : "h-9"}`}
      />
      <span className="flex flex-col leading-none">
        <span
          className={`font-medium tracking-[-0.03em] text-ink ${compact ? "text-[17px]" : "text-[18px]"}`}
        >
          итгэл
        </span>
        <span className="mt-0.5 text-[11px] font-medium tracking-[0.08em] text-muted uppercase">
          админ
        </span>
      </span>
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAdminSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="text-muted" />
      </div>
    );
  }

  // Нэвтрэх хуудас нь бүрхүүлгүй.
  if (!user) return <div className="min-h-dvh bg-surface">{children}</div>;

  return (
    <div className="min-h-dvh bg-surface">
      {/* Гар утасны толгой — цэс нь доошоо дэлгэгдэнэ. */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Цэс"
            aria-expanded={menuOpen}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[8px] border border-line bg-bg"
          >
            <span className="flex flex-col gap-[3px]">
              <span className="block h-[2px] w-4 rounded bg-ink" />
              <span className="block h-[2px] w-4 rounded bg-ink" />
              <span className="block h-[2px] w-4 rounded bg-ink" />
            </span>
          </button>
          <Brand compact />
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={signOut}
              className="h-9 cursor-pointer rounded-[8px] border border-line bg-bg px-3 text-[13px]"
            >
              Гарах
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-line bg-bg px-3 py-4">
            <NavLinks pathname={pathname} onNavigate={() => setMenuOpen(false)} />
          </div>
        )}
      </header>

      <div className="flex w-full">
        {/* Компьютерын хажуугийн цэс. */}
        <aside className="sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col border-r border-line bg-bg lg:flex">
          <div className="px-4 py-5">
            <Brand />
          </div>
          <div className="no-scrollbar flex-1 overflow-y-auto px-2 pb-4">
            <NavLinks pathname={pathname} />
          </div>
          <div className="border-t border-line px-4 py-3">
            <div className="mb-2 truncate text-[13px] text-ink-2">{user.name}</div>
            <button
              type="button"
              onClick={signOut}
              className="h-8 w-full cursor-pointer rounded-[8px] border border-line bg-bg px-3 text-[13px]"
            >
              Гарах
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 xl:px-10">{children}</main>
      </div>
    </div>
  );
}
