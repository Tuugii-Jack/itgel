"use client";

import { deferEffect } from "@/lib/deferEffect";
import { useCallback, useEffect, useState } from "react";
import { BATCH_STAGE_LABEL } from "@/components/admin/shared";
import { adminApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import type { AdminBatchDetail, BatchOrderRow } from "@/lib/types";

export function useBatchDetail(batchId: string, onListChanged: () => void) {
  const toast = useToast();
  const [batch, setBatch] = useState<AdminBatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [ordersLoaded, setOrdersLoaded] = useState(false);

  const load = useCallback(
    async (background = false, opts: { withOrders?: boolean } = {}) => {
      if (!background) setLoading(true);
      try {
        const withOrders = opts.withOrders === true;
        const next = await adminApi.batch(batchId, withOrders ? undefined : { slim: "1" });
        setBatch((prev) => {
          if (!withOrders && prev && prev.orders.length > 0) {
            return { ...next, orders: prev.orders, omittedOrders: prev.omittedOrders };
          }
          return next;
        });
        if (withOrders) setOrdersLoaded(true);
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Ачаалж чадсангүй.");
      } finally {
        setLoading(false);
      }
    },
    [batchId],
  );

  useEffect(() => deferEffect(() => { void load(); }), [load]);

  const loadOrders = useCallback(async () => {
    if (ordersLoaded && (batch?.orders.length ?? 0) > 0) return;
    try {
      const next = await adminApi.batch(batchId);
      setBatch(next);
      setOrdersLoaded(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Захиалга ачаалж чадсангүй.");
    }
  }, [batchId, batch?.orders.length, ordersLoaded]);

  const advance = async () => {
    if (!batch?.nextStage) return;
    setBusyKey("advance");
    try {
      await adminApi.advanceBatch(batch.id);
      await load(true, { withOrders: ordersLoaded });
      onListChanged();
      toast.success(
        batch.nextStage === "AT_WAREHOUSE"
          ? "Багц агуулахад орлоо. Ирсэн тоо цаашид засагдахгүй."
          : `Багц «${BATCH_STAGE_LABEL[batch.nextStage]}» шатанд орлоо.`,
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Шат ахиулж чадсангүй.");
    } finally {
      setBusyKey(null);
    }
  };

  const revert = async () => {
    if (!batch?.previousStage) return;
    setBusyKey("revert");
    try {
      await adminApi.revertBatchStage(batch.id);
      await load(true, { withOrders: ordersLoaded });
      onListChanged();
      toast.success(`Багц «${BATCH_STAGE_LABEL[batch.previousStage]}» шат руу буцлаа.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Шат буцааж чадсангүй.");
    } finally {
      setBusyKey(null);
    }
  };

  const removeProduct = async (roundId: string, name: string) => {
    setBusyKey(`remove:${roundId}`);
    try {
      await adminApi.removeBatchProduct(batchId, roundId);
      setBatch((prev) =>
        prev ? { ...prev, products: prev.products.filter((p) => p.roundId !== roundId) } : prev,
      );
      toast.success(`«${name}» багцаас салгалаа.`);
      await load(true, { withOrders: ordersLoaded });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Хасаж чадсангүй.");
    } finally {
      setBusyKey(null);
    }
  };

  const omitOrder = async (order: BatchOrderRow) => {
    setBusyKey(`omit:${order.id}`);
    try {
      await adminApi.omitBatchOrder(batchId, order.id);
      toast.success(`${order.code} багцаас хаслаа.`);
      await load(true, { withOrders: true });
      onListChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Хасаж чадсангүй.");
    } finally {
      setBusyKey(null);
    }
  };

  const reinstateOrder = async (order: BatchOrderRow) => {
    setBusyKey(`reinstate:${order.id}`);
    try {
      await adminApi.reinstateBatchOrder(batchId, order.id);
      toast.success(`${order.code} дахин орлоо — хүлээж авахад бэлэн.`);
      await load(true, { withOrders: true });
      onListChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Оруулж чадсангүй.");
    } finally {
      setBusyKey(null);
    }
  };

  return {
    batch,
    setBatch,
    loading,
    error,
    busyKey,
    load,
    loadOrders,
    advance,
    revert,
    removeProduct,
    omitOrder,
    reinstateOrder,
  };
}
