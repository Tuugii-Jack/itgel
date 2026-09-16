"use client";

import { Metric, Select } from "@/components/admin/shared";
import { Empty, ErrorNote, Spinner } from "@/components/ui";
import { dayLabel, money, MONTH_LABELS } from "@/lib/format";
import type { HandoverReceiptStore } from "@/lib/handoverReceipt";
import type { HandoverHistory } from "@/lib/types";
import { HistoryDayDetail } from "./HistoryDayDetail";

export function HistoryPanel({
  year,
  month,
  years,
  onYear,
  onMonth,
  history,
  loading,
  error,
  openDate,
  onOpenDate,
  store,
}: {
  year: number;
  month: number;
  years: number[];
  onYear: (v: number) => void;
  onMonth: (v: number) => void;
  history: HandoverHistory | null;
  loading: boolean;
  error: string | null;
  openDate: string | null;
  onOpenDate: (date: string) => void;
  store?: HandoverReceiptStore;
}) {
  const open = history?.days.find((d) => d.date === openDate) ?? null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select
          value={String(year)}
          onChange={(v) => onYear(Number(v))}
          options={years.map((y) => ({ value: String(y), label: `${y} он` }))}
        />
        <Select
          value={String(month)}
          onChange={(v) => onMonth(Number(v))}
          options={MONTH_LABELS.map((m, i) => ({ value: String(i + 1), label: m }))}
        />
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-muted" />
        </div>
      ) : !history || history.days.length === 0 ? (
        <Empty>Энэ сард хүлээлгэн өгсөн бараа алга.</Empty>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Metric label="Бэлэн" value={money(history.summary.cash)} tone="ok" />
            <Metric label="Карт" value={money(history.summary.card)} />
            <Metric label="Данс" value={money(history.summary.bank)} />
            <Metric label="Хүн" value={history.summary.customerCount} tone="info" />
            <Metric label="Бараа" value={history.summary.itemCount} />
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {history.days.map((d) => (
              <button
                key={d.date}
                type="button"
                onClick={() => onOpenDate(d.date)}
                className={`cursor-pointer rounded-[12px] border p-3 text-left ${
                  openDate === d.date ? "border-ink bg-surface" : "border-line bg-bg hover:bg-surface"
                }`}
              >
                <div className="text-[14px]">{dayLabel(`${d.date}T12:00:00+08:00`)}</div>
                <div className="tnum mt-1 text-[16px] font-medium text-ok">{money(d.cash)}</div>
                <div className="tnum text-[12px] text-muted">
                  бэлэн · карт {money(d.card)}
                </div>
                <div className="mt-1 text-[12px] text-muted">
                  {d.customerCount} хүн · {d.itemCount} бараа
                </div>
              </button>
            ))}
          </div>

          {open && <HistoryDayDetail day={open} store={store} />}
        </>
      )}
    </div>
  );
}
