"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useState } from "react";
import { adminApi, ApiError } from "@/lib/api";
import type { AdminBatch } from "@/lib/types";

export function useBatches() {
  const [batches, setBatches] = useState<AdminBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Нээлттэй багц — жагсаалтын оронд дэлгэрэнгүй харагдана. */
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  /** Багцын дотроос нээсэн захиалга. */
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const list = await adminApi.batches({ pageSize: 100 });
      setBatches(list.data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffect(() => { void load(); }), [load]);

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

  const active = batches.filter((b) => b.stage !== "DONE");

  return {
    batches,
    setBatches,
    loading,
    error,
    openBatchId,
    setOpenBatchId,
    openOrderId,
    setOpenOrderId,
    creating,
    setCreating,
    load,
    active,
  };
}
