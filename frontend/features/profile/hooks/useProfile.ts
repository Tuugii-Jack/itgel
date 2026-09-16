import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { deferEffect } from "@/lib/deferEffect";
import type { MyOrder, Store } from "@/lib/types";

export function useProfile() {
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [totals, setTotals] = useState({ totalSpent: 0, activeCount: 0 });
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [result, s] = await Promise.all([api.myOrders(), api.store()]);
      setOrders(result.data);
      setTotals({
        totalSpent: result.meta.totalSpent,
        activeCount: result.meta.activeCount,
      });
      setStore(s);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Захиалга ачаалж чадсангүй.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffect(() => { void load(); }), [load]);

  return { orders, totals, store, loading, error, load };
}
