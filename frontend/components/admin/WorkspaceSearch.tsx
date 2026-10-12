"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { adminApi, leasingApi } from "@/lib/api";
import { useAdminSession } from "@/lib/admin-session";
import { customerNameLabel, money, phoneLabel } from "@/lib/format";
import { searchWorkspaceLinks, workspaceHref, type WorkspaceLink, type WorkspacePortal } from "@/lib/workspaceNavigation";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceIcon } from "./WorkspaceIcon";

type SearchResult = { id: string; label: string; detail: string; href: string };
export function WorkspaceSearch({ portal, links, open, onClose }: {
  portal: WorkspacePortal; links: WorkspaceLink[]; open: boolean; onClose: () => void;
}) {
  const { user } = useAdminSession();
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<SearchResult[]>([]);
  const [customers, setCustomers] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [resultQuery, setResultQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => { setQuery(""); input.current?.focus(); }, 0);
    return () => clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    const requests = sequence;
    const request = ++requests.current;
    const text = query.trim();
    const timer = setTimeout(async () => {
      setOrders([]); setCustomers([]); setError(false);
      if (!open || text.length < 2) { setLoading(false); return; }
      setLoading(true);
      const api = portal === "leasing" ? leasingApi : adminApi;
      const values = await Promise.allSettled([
        api.orders({ q: text, pageSize: 5 }), api.customers({ q: text, pageSize: 5 }),
      ]);
      if (request !== sequence.current) return;
      setResultQuery(text);
      const root = `/workspace/${portal}`;
      const [orderResult, customerResult] = values;
      if (orderResult.status === "fulfilled") setOrders(orderResult.value.data.map((order) => ({
        id: order.id, label: order.code, detail: `${customerNameLabel(order.customer.name)} · ${money(order.dueAmount)} үлдэгдэл`,
        href: workspaceHref(root, { order: order.id }),
      })));
      if (customerResult.status === "fulfilled") setCustomers(customerResult.value.data.map((customer) => ({
        id: customer.id, label: customerNameLabel(customer.name), detail: phoneLabel(customer.phone),
        href: workspaceHref(`${root}/customers`, { id: customer.id }),
      })));
      setError(values.some((result) => result.status === "rejected"));
      setLoading(false);
    }, 280);
    return () => { clearTimeout(timer); requests.current++; };
  }, [query, open, portal, user?.id]);
  const sections = searchWorkspaceLinks(links, query);
  const currentResults = resultQuery === query.trim();
  const close = () => { sequence.current++; setOrders([]); setCustomers([]); onClose(); };
  const resultGroup = (label: string, items: SearchResult[], icon: string) => items.length > 0 && (
    <section className="border-t border-line px-3 py-3">
      <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      {items.map((item) => <Link key={item.id} href={item.href} onClick={close}
        className="flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 text-ink no-underline hover:bg-primary-soft focus-visible:bg-primary-soft">
        <WorkspaceIcon name={icon} />
        <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{item.label}</span>
          <span className="block truncate text-[12px] text-ink-2">{item.detail}</span></span>
        <ArrowUpRight className="h-4 w-4 text-muted" aria-hidden="true" />
      </Link>)}
    </section>
  );
  return <WorkspaceDialog open={open} onClose={close} title="Хурдан хайлт">
    <div className="flex items-center gap-3 border-b border-line px-5 py-3">
      <Search className="h-5 w-5 text-muted" aria-hidden="true" />
      <input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" maxLength={60}
        aria-label="Хэсэг, захиалгын код, хэрэглэгчийн нэр эсвэл утас хайх"
        placeholder="Хэсэг, захиалгын код, нэр, утас…" className="h-11 min-w-0 flex-1 border-0 bg-transparent text-[16px] outline-none"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); results.current?.querySelector<HTMLAnchorElement>("a")?.focus(); }
          if (event.key === "Enter") { event.preventDefault(); results.current?.querySelector<HTMLAnchorElement>("a")?.click(); }
        }} />
    </div>
    <div ref={results} className="max-h-[55dvh] overflow-y-auto" onKeyDown={(event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [...results.current!.querySelectorAll<HTMLAnchorElement>("a")];
      const current = items.indexOf(document.activeElement as HTMLAnchorElement);
      const next = current + (event.key === "ArrowDown" ? 1 : -1);
      event.preventDefault(); if (next < 0) input.current?.focus(); else items[Math.min(next, items.length - 1)]?.focus();
    }}>
      {query.trim().length >= 2 && <div role="status" className="px-5 py-3 text-[12px] text-ink-2">
        {loading || !currentResults ? "Захиалга, хэрэглэгч хайж байна…" : error ? "Зарим мэдээлэл ачаалагдсангүй. Хэсгийн хайлтаас дахин оролдоорой." :
          orders.length + customers.length === 0 ? "Тохирох захиалга, хэрэглэгч олдсонгүй." : "Хайлтын үр дүн"}
      </div>}
      {currentResults && query.trim().length >= 2 && resultGroup("Захиалга", orders, "orders")}
      {currentResults && query.trim().length >= 2 && resultGroup("Хэрэглэгч", customers, "customers")}
      {sections.length > 0 && <section className="border-t border-line px-3 py-3">
        <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted">Ажлын хэсгүүд</div>
        {sections.map((link) => <Link key={link.href} href={link.href} onClick={close}
          className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-[14px] text-ink no-underline hover:bg-primary-soft focus-visible:bg-primary-soft">
          <WorkspaceIcon name={link.icon} /><span className="flex-1">{link.label}</span><span className="text-[11px] text-muted">{link.group}</span>
        </Link>)}
      </section>}
    </div>
    <div className="border-t border-line px-5 py-3 text-[12px] text-muted">↑ ↓ сонгох · Enter нээх · Esc хаах</div>
  </WorkspaceDialog>;
}
