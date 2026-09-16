import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, ApiError } from "@/lib/api";
import { deferEffect } from "@/lib/deferEffect";
import { dayKey } from "@/lib/format";
import { useOnKeyChange } from "@/lib/syncKey";
import { useToast } from "@/lib/toast";
import type { AdminDelivery, DeliveryHistory } from "@/lib/types";
import { monthCells } from "../utils";

export function useDeliveryHistory() {
  const toast = useToast();
  const today = useMemo(() => new Date(), []);
  const todayKey = dayKey(today);
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = today.getFullYear() + 1; y >= today.getFullYear() - 4; y--) list.push(y);
    return list;
  }, [today]);

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [history, setHistory] = useState<DeliveryHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [dayRows, setDayRows] = useState<AdminDelivery[] | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  const cells = useMemo(() => monthCells(year, month), [year, month]);

  const loadHistory = useCallback(async (y: number, m: number) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await adminApi.deliveryHistory(y, m);
      setHistory(data);
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

  const openHistoryDay = useCallback(
    async (date: string) => {
      setOpenDate(date);
      setDayLoading(true);
      try {
        setDayRows(await adminApi.deliveries({ day: date, pageSize: 200 }));
      } catch (e) {
        setDayRows([]);
        toast.error(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
      } finally {
        setDayLoading(false);
      }
    },
    [toast],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, DeliveryHistory["days"][number]>();
    for (const d of history?.days ?? []) map.set(d.date, d);
    return map;
  }, [history]);

  const selectableDates = history?.days.map((d) => d.date) ?? [];

  return {
    today,
    todayKey,
    years,
    year,
    month,
    setYear,
    setMonth,
    history,
    historyLoading,
    historyError,
    openDate,
    setOpenDate,
    dayRows,
    dayLoading,
    loadHistory,
    openHistoryDay,
    cells,
    byDate,
    selectableDates,
  };
}
