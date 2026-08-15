"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Spinner } from "@/components/ui";
import { helperAdminCanAccess, isFullAdmin, ROLE_LABEL } from "@/lib/admin-role";
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
      { href: "/admin/orders/new", label: "Захиалга оруулах" },
      { href: "/admin/orders/by-product", label: "Бараагаар" },
      { href: "/admin/handover", label: "Хүлээлгэн өгөх" },
      { href: "/admin/deliveries", label: "Хүргэлт" },
      { href: "/admin/returns", label: "Буцаалт" },
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

function groupHasActive(
  pathname: string,
  items: { href: string; label: string }[],
): boolean {
  return items.some((item) => isActive(pathname, item.href));
}

function NavLinks({
  pathname,
  groups,
  onNavigate,
}: {
  pathname: string;
  groups: { label: string; items: { href: string; label: string }[] }[];
  onNavigate?: () => void;
}) {
  const activeGroup =
    groups.find((group) => groupHasActive(pathname, group.items))?.label ?? null;
  const [open, setOpen] = useState<string | null>(activeGroup);

  useEffect(() => {
    if (activeGroup) setOpen(activeGroup);
  }, [activeGroup]);

  return (
    <nav className="flex flex-col gap-0.5">
      {groups.map((group) => {
        const expanded = open === group.label;
        const current = groupHasActive(pathname, group.items);
        return (
          <div key={group.label}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen((prev) => (prev === group.label ? null : group.label))}
              className={`flex h-10 w-full cursor-pointer items-center justify-between rounded-[8px] border-0 px-3 text-left text-[14px] transition-colors
                ${
                  current
                    ? "bg-surface-2 font-medium text-ink"
                    : "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink"
                }`}
            >
              {group.label}
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
                aria-hidden
              >
                <path d="M3 5.5 7 9.5 11 5.5" />
              </svg>
            </button>
            {expanded && (
              <div className="mt-0.5 mb-1 flex flex-col gap-0.5 pl-2">
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      className={`rounded-[8px] px-3 py-2 text-[14px] no-underline transition-colors
                        ${active ? "bg-ink font-medium text-white" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ compact = false, helper = false }: { compact?: boolean; helper?: boolean }) {
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
          {helper ? "туслах админ" : "админ"}
        </span>
      </span>
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAdminSession();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const onLoginPage = pathname === "/admin/login";
  const helper = Boolean(user && !isFullAdmin(user.role));
  const navGroups = helper
    ? NAV_GROUPS.filter((g) => g.label === "Захиалга" || g.label === "Харилцагч")
    : NAV_GROUPS;

  useEffect(() => {
    if (!user || isFullAdmin(user.role)) return;
    if (!helperAdminCanAccess(pathname)) router.replace("/admin");
  }, [user, pathname, router]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="text-muted" />
      </div>
    );
  }

  // Нэвтрээгүй: зөвхөн нэвтрэх хуудсыг харуулна — бусад admin хуудас render хийхгүй.
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

  // Нэвтэрсэн хүн login дээр бол redirect хүртэл хоосон.
  if (onLoginPage) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="text-muted" />
      </div>
    );
  }

  if (helper && !helperAdminCanAccess(pathname)) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="text-muted" />
      </div>
    );
  }

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
          <Brand compact helper={helper} />
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
            <NavLinks
              pathname={pathname}
              groups={navGroups}
              onNavigate={() => setMenuOpen(false)}
            />
            <Link
              href="/admin/account"
              onClick={() => setMenuOpen(false)}
              className="mt-3 block px-3 py-2 text-[13px] text-ink-2 no-underline"
            >
              Нууц үг солих
            </Link>
          </div>
        )}
      </header>

      <div className="flex w-full">
        {/* Компьютерын хажуугийн цэс. */}
        <aside className="sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col border-r border-line bg-bg lg:flex">
          <div className="px-4 py-5">
            <Brand helper={helper} />
          </div>
          <div className="no-scrollbar flex-1 overflow-y-auto px-2 pb-4">
            <NavLinks pathname={pathname} groups={navGroups} />
          </div>
          <div className="border-t border-line px-4 py-3">
            <div className="mb-0.5 truncate text-[13px] text-ink-2">{user.name}</div>
            <div className="mb-2 text-[11px] text-muted">{ROLE_LABEL[user.role] ?? user.role}</div>
            <Link
              href="/admin/account"
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
