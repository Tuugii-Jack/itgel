"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Spinner } from "@/components/ui";
import { AdminSessionProvider, useAdminSession } from "@/lib/admin-session";

const NAV = [
  { href: "/admin", label: "Захиалга" },
  { href: "/admin/storefront", label: "Дэлгүүр" },
  { href: "/admin/handover", label: "Хүлээлгэн өгөх" },
  { href: "/admin/batches", label: "Багц" },
  { href: "/admin/deliveries", label: "Хүргэлт" },
  { href: "/admin/products", label: "Бараа" },
  { href: "/admin/ads", label: "Зар" },
  { href: "/admin/categories", label: "Ангилал" },
  { href: "/admin/customers", label: "Хэрэглэгчид" },
  { href: "/admin/reports", label: "Тайлан" },
  { href: "/admin/settings", label: "Тохиргоо" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminSessionProvider>
      <Shell>{children}</Shell>
    </AdminSessionProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAdminSession();
  const pathname = usePathname();

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
      <header className="sticky top-0 z-20 border-b border-line bg-bg">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-3">
          <span className="text-[15px] font-medium">itgel</span>
          <span className="text-[13px] text-muted">админ</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[13px] text-ink-2 sm:inline">{user.name}</span>
            <button
              type="button"
              onClick={signOut}
              className="h-9 cursor-pointer rounded-[8px] border border-line bg-bg px-3 text-[13px]"
            >
              Гарах
            </button>
          </div>
        </div>

        <nav className="no-scrollbar mx-auto flex max-w-[1200px] gap-1 overflow-x-auto px-4 pb-2">
          {NAV.map((item) => {
            const active =
              item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 rounded-[8px] px-3 py-1.5 text-[13px] no-underline
                  ${active ? "bg-ink text-white" : "text-ink-2 hover:bg-surface"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 py-6">{children}</main>
    </div>
  );
}
