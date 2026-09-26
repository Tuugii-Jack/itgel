"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHead } from "@/components/admin/shared";
import { Button, Card, Empty, ErrorNote, Skeleton } from "@/components/ui";
import { adminApi, leasingApi, ApiError } from "@/lib/api";
import { deferEffect } from "@/lib/deferEffect";
import { dayLabel, money } from "@/lib/format";
import { isOwner } from "@/lib/admin-role";
import { useAdminSession } from "@/lib/admin-session";

export type TodayCard = {
  key: string;
  label: string;
  count: number;
  amount: number | null;
  paidAmount?: number | null;
  remainingAmount?: number | null;
  href: string;
};

type TodayRow = {
  id: string;
  code?: string;
  amount?: number;
  label?: string;
  href?: string;
  at?: string | null;
  purpose?: string;
  status?: string;
  error?: string;
  createdAt?: string;
};

export function TodayWorkBoard({ portal }: { portal: "shop" | "leasing" }) {
  const { user } = useAdminSession();
  const [day, setDay] = useState<string | null>(null);
  const [cards, setCards] = useState<TodayCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ownerAdminId, setOwnerAdminId] = useState("");
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [rows, setRows] = useState<TodayRow[] | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data =
        portal === "leasing"
          ? await leasingApi.todayWork()
          : await adminApi.todayWork({ ownerAdminId: ownerAdminId || undefined });
      setDay(data.day);
      setCards(data.cards);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    }
  }, [portal, ownerAdminId]);

  useEffect(() => deferEffect(() => { void load(); }), [load]);

  useEffect(() => {
    if (!isOwner(user?.role) || portal !== "shop") return;
    void adminApi.leasingSettlementOperators().then((list) => {
      setOwners(list.map((op) => ({ id: op.id, name: op.name })));
    }).catch(() => undefined);
  }, [portal, user?.role]);

  const loadRows = useCallback(async (key: string, nextPage = 1) => {
    setRowsError(null);
    setRows(null);
    try {
      const result =
        portal === "leasing"
          ? await leasingApi.todayWorkRows({ card: key, day: day ?? undefined, page: nextPage })
          : await adminApi.todayWorkRows({
              card: key,
              day: day ?? undefined,
              ownerAdminId: ownerAdminId || undefined,
              page: nextPage,
            });
      setRows(result.data);
      setPage(result.meta?.page ?? 1);
      setPages(result.meta?.pages ?? 1);
      setTotal(result.meta?.total ?? 0);
    } catch (e) {
      setRowsError(e instanceof ApiError ? e.message : "Жагсаалт ачаалж чадсангүй.");
    }
  }, [portal, day, ownerAdminId]);

  const openCard = (card: TodayCard) => {
    setOpenKey(card.key);
    void loadRows(card.key, 1);
  };

  return (
    <div>
      <PageHead
        title="Өнөөдрийн ажил"
        hint={day ? `Asia/Ulaanbaatar · ${day}` : "Өнөөдрийн хийх зүйлс"}
      />
      {isOwner(user?.role) && portal === "shop" && (
        <label className="mb-4 flex max-w-md flex-col gap-1 text-[12px] text-muted">
          Эзэн
          <select
            value={ownerAdminId}
            onChange={(e) => setOwnerAdminId(e.target.value)}
            className="h-10 w-full rounded-[8px] border border-line bg-bg px-3 text-[14px]"
          >
            <option value="">Бүгд</option>
            {owners.map((op) => (
              <option key={op.id} value={op.id}>
                {op.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <div className="mb-4">
          <ErrorNote>
            {error}{" "}
            <button type="button" className="underline" onClick={() => void load()}>
              Дахин оролдох
            </button>
          </ErrorNote>
        </div>
      )}
      {cards === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-[12px]" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <Empty>Энэ эрхээр харах өнөөдрийн ажил алга.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={() => openCard(card)}
              className="cursor-pointer text-left"
            >
              <Card className={`h-full p-4 ${openKey === card.key ? "border-ink" : ""}`}>
                <div className="text-[13px] text-muted">{card.label}</div>
                <div className="mt-2 tnum text-[28px] font-medium">{card.count}</div>
                {card.amount != null && (
                  <div className="mt-1 tnum text-[14px] text-ink-2">
                    {card.key === "arrived_unhanded" ? `${card.amount} ш` : money(card.amount)}
                  </div>
                )}
                {card.paidAmount != null && card.remainingAmount != null && (
                  <div className="mt-1 text-[13px] text-muted">
                    Төлсөн {money(card.paidAmount)} · үлдсэн {money(card.remainingAmount)}
                  </div>
                )}
              </Card>
            </button>
          ))}
        </div>
      )}

      {openKey && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-[15px] font-medium">
              {cards?.find((c) => c.key === openKey)?.label ?? "Жагсаалт"}
              {total > 0 ? ` · ${total}` : ""}
            </div>
            <Button size="sm" variant="outline" onClick={() => setOpenKey(null)}>
              Хаах
            </Button>
          </div>
          {rowsError && (
            <ErrorNote>
              {rowsError}{" "}
              <button type="button" className="underline" onClick={() => void loadRows(openKey, page)}>
                Дахин оролдох
              </button>
            </ErrorNote>
          )}
          {rows === null && !rowsError ? (
            <Skeleton className="h-32 rounded-[12px]" />
          ) : rows && rows.length === 0 ? (
            <Empty>Мөр алга.</Empty>
          ) : (
            <Card className="divide-y divide-line">
              {(rows ?? []).map((row) => (
                <div key={row.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="tnum text-[14px]">{row.code ?? row.purpose ?? row.id}</div>
                    <div className="text-[13px] text-muted">
                      {row.label ?? row.status ?? ""}
                      {row.at || row.createdAt ? ` · ${dayLabel(row.at ?? row.createdAt ?? "")}` : ""}
                      {row.error ? ` · ${row.error}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {row.amount != null && (
                      <span className="tnum text-[14px]">
                        {openKey === "arrived_unhanded" ? `${row.amount} ш` : money(row.amount)}
                      </span>
                    )}
                    {row.href && (
                      <Link href={row.href} className="text-[13px]">
                        Нээх
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          )}
          {pages > 1 && (
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => void loadRows(openKey, page - 1)}>
                Өмнөх
              </Button>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => void loadRows(openKey, page + 1)}>
                Дараах
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
