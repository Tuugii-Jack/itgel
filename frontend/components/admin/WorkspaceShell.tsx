"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronRight, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { Spinner } from "@/components/ui";
import { helperAdminCanAccess, isFullAdmin, isLeasingAdmin, ROLE_LABEL, workspaceSectionsFor } from "@/lib/admin-role";
import { AdminSessionProvider, useAdminSession } from "@/lib/admin-session";
import { activeWorkspaceLink, workspaceLinksFor, type WorkspacePortal } from "@/lib/workspaceNavigation";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceSearch } from "./WorkspaceSearch";

const Loading = () => <div className="flex min-h-dvh items-center justify-center"><Spinner className="text-muted" /></div>;
export function WorkspaceShell({ portal, children }: { portal: WorkspacePortal; children: ReactNode }) {
  return <AdminSessionProvider portal={portal}><Suspense fallback={<Loading />}><Frame portal={portal}>{children}</Frame></Suspense></AdminSessionProvider>;
}

function Frame({ portal, children }: { portal: WorkspacePortal; children: ReactNode }) {
  const { user, loading, signOut } = useAdminSession();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const allowed = portal === "leasing" ? isLeasingAdmin(user?.role) : isFullAdmin(user?.role) || helperAdminCanAccess(pathname);
  const links = workspaceLinksFor(portal, user?.role);
  const current = activeWorkspaceLink(pathname, links);
  useEffect(() => { if (user && !allowed) router.replace("/workspace/shop/today"); }, [user, allowed, router]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen((value) => !value); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  if (loading || !user || !allowed) return <Loading />;
  const root = `/workspace/${portal}`;
  const groups = [...new Set(links.map((link) => link.group))];
  const home = `${root}/today`;
  const brand = <Link href={home} className="flex items-center gap-3 text-ink no-underline">
    <Image src="/logo.png" alt="Итгэл" width={34} height={34} priority className="h-9 w-auto" />
    {!compact && <span><span className="block text-[18px] font-medium tracking-tight">итгэл</span><span className="block text-[11px] text-muted">{portal === "shop" ? "Үндсэн админ" : "Лизингийн админ"}</span></span>}
  </Link>;
  const navigation = (mobile = false) => <nav aria-label="Ажлын хэсгүүд" className="flex flex-col gap-4">
    {groups.map((group) => <div key={group}>
      {(!compact || mobile) && <div className="mb-1.5 px-3 text-[10px] font-medium uppercase tracking-[0.1em] text-muted">{group}</div>}
      <div className="flex flex-col gap-0.5">{links.filter((link) => link.group === group).map((link) => {
        const active = link.href === current?.href;
        return <Link key={link.href} href={link.href} onClick={() => setMenuOpen(false)} aria-current={active ? "page" : undefined}
          title={compact && !mobile ? link.label : undefined}
          className={`flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] no-underline transition-colors ${active ? "bg-secondary-soft font-medium text-secondary" : "text-ink-2 hover:bg-surface-2 hover:text-ink"} ${compact && !mobile ? "justify-center" : ""}`}>
          <WorkspaceIcon name={link.icon} />{(!compact || mobile) && <span>{link.label}</span>}
        </Link>;
      })}</div>
    </div>)}
  </nav>;
  const quickHref = portal === "shop" && isFullAdmin(user.role) ? `${root}/orders/new` : portal === "shop" ? `${root}/handover` : `${root}?goods=pay_due_today`;
  const quickLabel = portal === "shop" && isFullAdmin(user.role) ? "Захиалга оруулах" : portal === "shop" ? "Хүлээлгэн өгөх" : "Өнөөдрийн төлөлт";
  return <div className="workspace-ui min-h-dvh bg-surface">
    <a href="#workspace-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-bg focus:p-3">Агуулга руу очих</a>
    <aside className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-bg lg:flex ${compact ? "w-[76px]" : "w-[244px]"}`}>
      <div className="flex h-[76px] shrink-0 items-center px-5">{brand}</div>
      <div className="mb-3 px-3"><button type="button" onClick={() => setSearchOpen(true)} aria-label="Хурдан хайлт"
        className="flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[12px] text-ink-2 hover:border-primary-muted">
        <Search className="h-4 w-4" aria-hidden="true" />{!compact && <><span className="flex-1 text-left">Хурдан хайлт</span><kbd className="text-[10px] text-muted">⌘ K</kbd></>}
      </button></div>
      <div className="flex-1 overflow-y-auto px-2 pb-5">{navigation()}</div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line p-3">
        {!compact && <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{user.name}</span><span className="text-[11px] text-muted">{ROLE_LABEL[user.role]}</span></span>}
        <button type="button" onClick={() => setCompact((value) => !value)} aria-label={compact ? "Цэсийг дэлгэх" : "Цэсийг хураах"}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2">{compact ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}</button>
      </div>
    </aside>
    <div className={compact ? "lg:pl-[76px]" : "lg:pl-[244px]"}>
      <header className="sticky top-0 z-20 flex min-h-[68px] flex-wrap items-center gap-3 border-b border-line bg-bg px-4 py-3 lg:px-7">
        <button type="button" onClick={() => setMenuOpen(true)} aria-label="Цэс нээх" className="flex h-10 w-10 items-center justify-center rounded-lg border border-line lg:hidden"><Menu className="h-5 w-5" /></button>
        <nav aria-label="Байршил" className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-ink-2">
          <Link href={home} className="hidden text-ink-2 no-underline sm:block">{portal === "shop" ? "Үндсэн админ" : "Лизинг"}</Link>
          <ChevronRight className="hidden h-3 w-3 text-muted sm:block" aria-hidden="true" />
          <span className="truncate font-medium text-ink">{current?.label ?? "Ажлын хэсэг"}</span>
        </nav>
        <button type="button" onClick={() => setSearchOpen(true)} aria-label="Хурдан хайлт" className="flex h-10 w-10 items-center justify-center rounded-lg border border-line lg:hidden"><Search className="h-4 w-4" /></button>
        {workspaceSectionsFor(user.role, user.destinations).length > 1 && <select aria-label="Ажлын хэсэг солих" value={portal}
          onChange={(event) => router.push(event.target.value === "store" ? "/" : `/workspace/${event.target.value}/today`)}
          className="hidden h-10 max-w-[145px] rounded-lg border border-line bg-bg px-2 text-[12px] sm:block">
          {workspaceSectionsFor(user.role, user.destinations).map((section) => <option value={section.id} key={section.id}>{section.label}</option>)}
        </select>}
        <Link href={quickHref} className="hidden h-10 items-center gap-2 rounded-lg bg-secondary px-3 text-[12px] font-medium text-white no-underline sm:inline-flex">
          <WorkspaceIcon name={portal === "shop" ? "add" : "money"} className="h-4 w-4" />{quickLabel}
        </Link>
        <Link href="/" title="Дэлгүүр нээх" aria-label="Дэлгүүр нээх" target="_blank" rel="noopener noreferrer" className="hidden h-10 w-10 items-center justify-center rounded-lg border border-line text-ink-2 sm:flex"><ArrowUpRight className="h-4 w-4" /></Link>
        <button type="button" onClick={signOut} title="Гарах" aria-label="Гарах" className="hidden h-10 w-10 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 sm:flex"><LogOut className="h-4 w-4" /></button>
      </header>
      <main id="workspace-content" tabIndex={-1} className="min-w-0 px-4 py-6 outline-none lg:px-7 lg:py-7 xl:px-9">{children}</main>
    </div>
    <WorkspaceDialog open={menuOpen} onClose={() => setMenuOpen(false)} title="Ажлын хэсгүүд" className="max-w-[380px]">
      <div className="p-4">{navigation(true)}<Link href={quickHref} onClick={() => setMenuOpen(false)} className="mt-5 flex h-11 items-center justify-center rounded-lg bg-secondary text-white no-underline">{quickLabel}</Link>
        <div className="mt-4 border-t border-line pt-3">
          {workspaceSectionsFor(user.role, user.destinations).filter((section) => section.id !== portal).map((section) => <Link key={section.id} href={section.id === "store" ? "/" : `${section.href}/today`} onClick={() => setMenuOpen(false)} className="flex min-h-11 items-center gap-3 px-3 text-[13px] text-ink no-underline"><ArrowUpRight className="h-4 w-4" />{section.label}</Link>)}
          <button type="button" onClick={signOut} className="flex min-h-11 w-full items-center gap-3 px-3 text-[13px] text-ink-2"><LogOut className="h-4 w-4" />Гарах</button>
        </div>
      </div>
    </WorkspaceDialog>
    <WorkspaceSearch portal={portal} links={links} open={searchOpen} onClose={() => setSearchOpen(false)} />
  </div>;
}
