import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, ApiError } from "@/lib/api";
import { deferEffect } from "@/lib/deferEffect";
import { dayKey } from "@/lib/format";
import { useOnKeyChange } from "@/lib/syncKey";
import type { HandoverHistory } from "@/lib/types";

export function useHandoverHistory() {
  const today = useMemo(() => new Date(), []);
  const todayKey = dayKey(today);
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = today.getFullYear() + 1; y >= today.getFullYear() - 4; y--) list.push(y);
    return list;
  }, [today]);

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [history, setHistory] = useState<HandoverHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(todayKey);
  const [todayTake, setTodayTake] = useState<{
    cash: number;
    card: number;
    bank: number;
  } | null>(null);

  const loadHistory = useCallback(async (y: number, m: number) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await adminApi.handoverHistory(y, m);
      setHistory(data);
      const now = new Date();
      if (y === now.getFullYear() && m === now.getMonth() + 1) {
        const day = data.days.find((d) => d.date === dayKey(now));
        setTodayTake({ cash: day?.cash ?? 0, card: day?.card ?? 0, bank: day?.bank ?? 0 });
      }
    } catch (e) {
      setHistory(null);
      setHistoryError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(
    () => deferEffect(() => { void loadHistory(year, month); }),
    [year, month, loadHistory],
  );

  const historyKey = history
    ? `${history.year}-${history.month}:${history.days.map((d) => d.date).join(",")}`
    : "";
  const openOk = Boolean(openDate && history?.days.some((d) => d.date === openDate));
  useOnKeyChange(`${historyKey}|${openOk ? openDate : ""}`, () => {
    if (!history || openOk) return;
    setOpenDate(history.days[0]?.date ?? null);
  });

  const goToToday = () => {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
    setOpenDate(dayKey(now));
    void loadHistory(now.getFullYear(), now.getMonth() + 1);
  };

  return {
    year,
    month,
    years,
    history,
    historyLoading,
    historyError,
    openDate,
    todayTake,
    setYear,
    setMonth,
    setOpenDate,
    loadHistory,
    goToToday,
  };
}
