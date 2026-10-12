"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, RefreshCw } from "lucide-react";
import { PageHead } from "@/components/admin/shared";
import { Button, Card, Empty, ErrorNote, Skeleton } from "@/components/ui";
import { WorkspaceIcon } from "@/components/admin/WorkspaceIcon";
import { adminApi, leasingApi, ApiError } from "@/lib/api";
import { deferEffect } from "@/lib/deferEffect";
import { dayLabel, money } from "@/lib/format";
import { isOwner } from "@/lib/admin-role";
import { useAdminSession } from "@/lib/admin-session";
import { updateWorkspaceQuery, useWorkspaceQuery } from "@/lib/useWorkspaceQuery";
import { normalizeWorkHref } from "@/lib/workspaceNavigation";
import { smsStatusLabel } from "@/lib/smsStatus";

export type TodayCard = { key: string; label: string; count: number; amount: number | null;
  paidAmount?: number | null; remainingAmount?: number | null; href: string };
type TodayRow = { id: string; code?: string; amount?: number; label?: string; href?: string;
  at?: string | null; purpose?: string; status?: string; error?: string; createdAt?: string };
const WORK: Record<string, { icon: string; hint: string; color: string; priority: number }> = {
  money_exception: { icon: "money", hint: "Төлбөрийн зөрүүг шалгаж шийдэх", color: "text-danger", priority: 0 },
  due_today: { icon: "money", hint: "Хуваарьт төлөлтийг шалгаж, сануулах", color: "text-warn", priority: 1 },
  arrived_unhanded: { icon: "handover", hint: "Агуулахад байгаа барааг хүлээлгэж өгөх", color: "text-info", priority: 2 },
  short_cargo: { icon: "batch", hint: "Ирсэн болон захиалсан тоог тулгах", color: "text-warn", priority: 3 },
  unlinked_batch: { icon: "batch", hint: "Багцын холбоосыг бүрэн болгох", color: "text-danger", priority: 4 },
  unpaid_itgel: { icon: "money", hint: "Төлөөгүй тооцоог шалгах", color: "text-warn", priority: 5 },
  sms_failed: { icon: "sms", hint: "Амжилтгүй мэдэгдлүүдийг шалгах", color: "text-danger", priority: 6 },
  sms_unknown: { icon: "sms", hint: "Мэдэгдлийн хүргэлтийг шалгах", color: "text-warn", priority: 7 },
  collected_today: { icon: "reports", hint: "Өнөөдрийн бүртгэгдсэн төлбөр", color: "text-ok", priority: 8 },
};
const purposeLabel = (value?: string) => value?.includes("arrival") ? "Бараа ирсэн мэдэгдэл" : value?.includes("otp") ? "Нэвтрэх код" : "Төлбөрийн мэдэгдэл";

export function TodayWorkBoard({ portal }: { portal: "shop" | "leasing" }) {
  const { user } = useAdminSession();
  const [day, setDay] = useState<string | null>(null);
  const [cards, setCards] = useState<TodayCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ownerQuery, setOwner] = useWorkspaceQuery("owner");
  const ownerAdminId = isOwner(user?.role) ? ownerQuery : "";
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [openKey] = useWorkspaceQuery("card");
  const [pageQuery, setPage] = useWorkspaceQuery("page", "1");
  const page = Math.max(1, Number.isSafeInteger(Number(pageQuery)) ? Number(pageQuery) : 1);
  const [rows, setRows] = useState<TodayRow[] | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const countRequest = useRef(0);
  const rowRequest = useRef(0);
  const load = useCallback(async () => {
    const request = ++countRequest.current;
    setError(null); setRefreshing(true);
    try {
      const api = portal === "leasing" ? leasingApi : adminApi;
      const data = await api.todayWork({ ownerAdminId: ownerAdminId || undefined });
      if (request !== countRequest.current) return;
      setDay(data.day); setCards(data.cards);
      setUpdatedAt(new Date().toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ulaanbaatar" }));
    } catch (e) {
      if (request === countRequest.current) setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally { if (request === countRequest.current) setRefreshing(false); }
  }, [portal, ownerAdminId]);
  useEffect(() => {
    const requests = countRequest;
    const cancel = deferEffect(() => { setCards(null); void load(); });
    return () => { cancel(); requests.current++; };
  }, [load]);
  useEffect(() => {
    if (!isOwner(user?.role)) return;
    let active = true;
    void adminApi.leasingSettlementOperators().then((list) => { if (active) setOwners(list.map((op) => ({ id: op.id, name: op.name }))); }).catch(() => undefined);
    return () => { active = false; };
  }, [user?.role, portal]);
  const loadRows = useCallback(async () => {
    const request = ++rowRequest.current;
    setRows(null); setRowsError(null); setTotal(0);
    if (!openKey) return;
    try {
      const api = portal === "leasing" ? leasingApi : adminApi;
      const result = await api.todayWorkRows({ card: openKey, day: day ?? undefined,
        ownerAdminId: ownerAdminId || undefined, page });
      if (request !== rowRequest.current) return;
      setRows(result.data); setPages(result.meta?.pages ?? 1); setTotal(result.meta?.total ?? 0);
    } catch (e) { if (request === rowRequest.current) setRowsError(e instanceof ApiError ? e.message : "Жагсаалт ачаалж чадсангүй."); }
  }, [portal, day, ownerAdminId, openKey, page]);
  useEffect(() => {
    const requests = rowRequest;
    const cancel = deferEffect(() => { void loadRows(); });
    return () => { cancel(); requests.current++; };
  }, [loadRows]);
  const openCard = (key: string) => updateWorkspaceQuery({ card: key, page: null });
  const current = cards?.find((card) => card.key === openKey);
  const tasks = (cards ?? []).filter((card) => card.key !== "collected_today").sort((a, b) =>
    Number(b.count > 0) - Number(a.count > 0) || (WORK[a.key]?.priority ?? 99) - (WORK[b.key]?.priority ?? 99));
  const paid = cards?.find((card) => card.key === "collected_today");
  return <div>
    <PageHead title="Өнөөдрийн ажил" hint={day ? `${dayLabel(day)} · Ажлаа эндээс эхлүүлээрэй` : "Өнөөдрийн хийх зүйлс"}
      actions={<Button size="sm" variant="outline" loading={refreshing} onClick={() => { void load(); if (openKey) void loadRows(); }}><RefreshCw className="h-4 w-4" />Шинэчлэх</Button>} />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2">
        <Link href={portal === "shop" ? "/workspace/shop/handover" : "/workspace/leasing?goods=pay_due_today"}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-bg px-3 text-[13px] text-ink no-underline"><WorkspaceIcon name={portal === "shop" ? "handover" : "money"} />{portal === "shop" ? "Бараа хүлээлгэж өгөх" : "Төлөлтийн хуваарь"}</Link>
        <Link href={`/workspace/${portal}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-bg px-3 text-[13px] text-ink no-underline"><WorkspaceIcon name="orders" />Бүх захиалга</Link>
      </div>
      {isOwner(user?.role) ? <label className="flex items-center gap-2 text-[12px] text-ink-2">Хариуцагч
        <select aria-label="Хариуцагчаар шүүх" value={ownerAdminId} onChange={(e) => { setOwner(e.target.value); setPage("1"); }} className="h-10 rounded-lg border border-line bg-bg px-3 text-[13px]">
          <option value="">Бүх хариуцагч</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
        </select></label> : updatedAt && <span className="text-[12px] text-muted">Сүүлд шинэчилсэн {updatedAt}</span>}
    </div>
    {error && <div className="mb-4"><ErrorNote>{error} <button className="underline" type="button" onClick={() => void load()}>Дахин оролдох</button></ErrorNote></div>}
    {cards === null ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-36" />)}</div> : <>
      {paid && <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 p-4"><div className="flex items-center gap-3"><span className="rounded-lg bg-ok-bg p-2 text-ok"><WorkspaceIcon name="reports" /></span><div><div className="text-[13px] text-ink-2">Өнөөдөр бүртгэсэн төлбөр</div><div className="tnum text-[22px] font-medium">{money(paid.amount ?? 0)}</div></div></div>
        <button type="button" onClick={() => openCard(paid.key)} className="flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-[13px]">{paid.count} гүйлгээ харах<ArrowRight className="h-4 w-4" /></button></Card>}
      {tasks.length === 0 ? <Empty>Энэ эрхээр харах ажлын жагсаалт алга.</Empty> : <>
        {tasks.every((card) => card.count === 0) && <div className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-bg px-4 py-3 text-[13px] text-ok"><CheckCircle2 className="h-4 w-4" />Эдгээр жагсаалтад хүлээгдсэн ажил алга.</div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{tasks.map((card) => {
          const config = WORK[card.key];
          return <button type="button" key={card.key} onClick={() => openCard(card.key)} aria-pressed={openKey === card.key}
            className={`flex min-h-[154px] flex-col rounded-xl border bg-bg p-4 text-left transition-colors hover:border-primary-muted ${openKey === card.key ? "border-secondary bg-secondary-soft/40" : "border-line"}`}>
            <div className="flex w-full items-start justify-between gap-3"><span className={`rounded-lg bg-surface p-2 ${card.count > 0 ? config?.color ?? "text-info" : "text-muted"}`}><WorkspaceIcon name={config?.icon ?? "orders"} /></span><span className={`tnum text-[26px] font-medium ${card.count > 0 ? config?.color : "text-muted"}`}>{card.count}</span></div>
            <span className="mt-3 text-[14px] font-medium">{card.label}</span><span className="mt-1 text-[12px] text-ink-2">{config?.hint ?? "Жагсаалтаа нээж шалгах"}</span>
            {card.amount != null && <span className="tnum mt-2 text-[13px] text-ink-2">{card.key === "arrived_unhanded" ? `${card.amount} ширхэг` : money(card.amount)}</span>}
            {card.paidAmount != null && card.remainingAmount != null && <span className="mt-1 text-[12px] text-ink-2">Төлсөн {money(card.paidAmount)} · үлдсэн {money(card.remainingAmount)}</span>}
          </button>;
        })}</div>
      </>}
    </>}
    {openKey && <section className="mt-6 scroll-mt-24" aria-label={current?.label ?? "Ажлын жагсаалт"}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="m-0 text-[16px] font-medium">{current?.label ?? "Жагсаалт"}{total > 0 ? ` · ${total}` : ""}</h2><div className="flex gap-2">
        {current && <Link href={normalizeWorkHref(current.href)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-bg px-3 text-[12px] text-ink no-underline">Ажлын хуудас<ArrowRight className="h-3 w-3" /></Link>}
        <Button size="sm" variant="ghost" onClick={() => { updateWorkspaceQuery({ card: null, page: null }); }}>Хаах</Button></div></div>
      {rowsError && <ErrorNote>{rowsError} <button className="underline" type="button" onClick={() => void loadRows()}>Дахин оролдох</button></ErrorNote>}
      {rows === null && !rowsError ? <Skeleton className="h-32" /> : rows?.length === 0 ? <Empty>Энэ жагсаалтад хийх ажил алга.</Empty> : <Card className="divide-y divide-line">{(rows ?? []).map((row) => <div key={row.id} className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0"><div className="tnum text-[14px] font-medium">{row.code ?? row.label ?? purposeLabel(row.purpose)}</div><div className="mt-1 text-[12px] text-ink-2">{row.label ?? (row.status ? smsStatusLabel(row.status) : "")}{row.at || row.createdAt ? ` · ${dayLabel(row.at ?? row.createdAt ?? "")}` : ""}</div>{row.error && <div className="mt-1 break-words text-[12px] text-danger">{row.error}</div>}</div>
        <div className="flex shrink-0 flex-col items-end gap-2">{row.amount != null && <span className="tnum text-[14px]">{openKey === "arrived_unhanded" ? `${row.amount} ширхэг` : money(row.amount)}</span>}{row.href && <Link href={normalizeWorkHref(row.href)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[12px] text-ink no-underline">Нээх<ArrowRight className="h-3 w-3" /></Link>}</div>
      </div>)}</Card>}
      {pages > 1 && <div className="mt-3 flex items-center justify-end gap-3"><span className="text-[12px] text-muted">{page} / {pages} хуудас</span><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(String(page - 1))}>Өмнөх</Button><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(String(page + 1))}>Дараах</Button></div>}
    </section>}
  </div>;
}
