"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useState } from "react";
import { adminApi, ApiError } from "@/lib/api";
import type { AdminBatch, BatchListSummary, BatchProgress } from "@/lib/types";

const PAGE_SIZE = 20;
const EMPTY_SUMMARY: BatchListSummary = {
  in_transit: 0,
  partial: 0,
  complete: 0,
  mismatch: 0,
};

export function useBatches() {
  const [batches, setBatches] = useState<AdminBatch[]>([]);
  const [summary, setSummary] = useState<BatchListSummary>(EMPTY_SUMMARY);
  const [pageMeta, setPageMeta] = useState({ page: 1, pages: 1, total: 0, pageSize: PAGE_SIZE });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<BatchProgress | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  /** Нээлттэй багц — жагсаалтын оронд дэлгэрэнгүй харагдана. */
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  /** Багцын дотроос нээсэн захиалга. */
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchList = useCallback(
    async (pageNum: number, background = false) => {
      if (!background) setLoading(true);
      try {
        const list = await adminApi.batches({
          q: query || undefined,
          progress: progress || undefined,
          from: from || undefined,
          to: to || undefined,
          page: pageNum,
          pageSize: PAGE_SIZE,
        });
        const metaSummary = list.meta?.summary as BatchListSummary | undefined;
        setBatches(list.data);
        setSummary(metaSummary ?? EMPTY_SUMMARY);
        setPageMeta({
          page: list.meta?.page ?? pageNum,
          pages: list.meta?.pages ?? 1,
          total: list.meta?.total ?? list.data.length,
          pageSize: list.meta?.pageSize ?? PAGE_SIZE,
        });
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
      } finally {
        setLoading(false);
      }
    },
    [query, progress, from, to],
  );

  const load = useCallback(
    async (background = false) => {
      await fetchList(1, background);
    },
    [fetchList],
  );

  useEffect(() => deferEffect(() => { void fetchList(1); }), [fetchList]);

  // OrderDetail-аас холбоосоор ирсэн багцыг нээнэ.
  useEffect(
    () =>
      deferEffect(() => {
        try {
          const id = sessionStorage.getItem("itgel.admin.openBatch");
          if (id) {
            sessionStorage.removeItem("itgel.admin.openBatch");
            setOpenBatchId(id);
          }
        } catch {
          /* ignore */
        }
      }),
    [],
  );

  const toggleProgress = (value: BatchProgress) => {
    setProgress((prev) => (prev === value ? "" : value));
  };

  return {
    batches,
    setBatches,
    summary,
    pageMeta,
    loading,
    error,
    search,
    setSearch,
    progress,
    setProgress,
    toggleProgress,
    from,
    setFrom,
    to,
    setTo,
    page: pageMeta.page,
    setPage: (next: number | ((current: number) => number)) => {
      const pageNum = typeof next === "function" ? next(pageMeta.page) : next;
      void fetchList(pageNum, true);
    },
    openBatchId,
    setOpenBatchId,
    openOrderId,
    setOpenOrderId,
    creating,
    setCreating,
    load,
  };
}
