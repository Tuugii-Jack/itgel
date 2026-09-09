"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Spinner } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/admin-role";
import { AdminSessionProvider, useAdminSession } from "@/lib/admin-session";

const NAV = [
  { href: "/leasing", label: "Захиалга" },
  { href: "/leasing/customers", label: "Хэрэглэгчид" },
];

export default function LeasingLayout({ children }: { children: ReactNode }) {
  return (
    <AdminSessionProvider portal="leasing">
      <Shell>{children}</Shell>
    </AdminSessionProvider>
  );
}

function isActive(pathname: string, href: string): boolean {
  return href === "/leasing" ? pathname === "/leasing" : pathname.startsWith(href);
}

function Shell({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAdminSession();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const onLoginPage = pathname === "/leasing/login";

  useEffect(() => {
    if (!user || user.role === "LEASING") return;
    router.replace("/admin");
  }, [user, router]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="text-muted" />
      </div>
    );
  }

  if (!user) {
    if (!onLoginPage) {
      return (
        <div className="flex min-h-dvh items-center justify-center">
          <Spinner className="text-muted" />
        </div>
      );
    }
    return <div className="min-h-dvh bg-surface">{children}</div>;
  }

  if (onLoginPage) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="text-muted" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-surface">
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
          <div className="ml-auto">
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
            <nav className="flex flex-col gap-0.5">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={`rounded-[8px] px-3 py-2 text-[14px] no-underline ${
                    isActive(pathname, item.href)
                      ? "bg-ink font-medium text-white"
                      : "text-ink-2"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <Link
              href="/leasing/account"
              onClick={() => setMenuOpen(false)}
              className="mt-3 block px-3 py-2 text-[13px] text-ink-2 no-underline"
            >
              Нууц үг солих
            </Link>
          </div>
        )}
      </header>

      <div className="flex w-full">
        <aside className="sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col border-r border-line bg-bg lg:flex">
          <div className="px-4 py-5">
            <Brand />
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 px-2">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-[8px] px-3 py-2 text-[14px] no-underline ${
                  isActive(pathname, item.href)
                    ? "bg-ink font-medium text-white"
                    : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-line px-4 py-3">
            <div className="mb-0.5 truncate text-[13px] text-ink-2">{user.name}</div>
            <div className="mb-2 text-[11px] text-muted">{ROLE_LABEL[user.role] ?? user.role}</div>
            <Link
              href="/leasing/account"
              className="mb-2 block text-[13px] text-ink-2 no-underline hover:text-ink hover:underline"
            >
              Нууц үг солих
            </Link>
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

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/leasing"
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
          лизинг
        </span>
      </span>
    </Link>
  );
}
