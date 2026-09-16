import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { adminApi, ApiError } from "@/lib/api";
import { deferEffect } from "@/lib/deferEffect";
import { shopDueOf } from "@/lib/leasing";
import { useToast } from "@/lib/toast";
import type { AdminOrderRow, HandoverCustomer } from "@/lib/types";
import { isReceiptItem, selectableItemIds, type Found } from "../utils";

export function useHandoverSearch({
  setBusy,
  setError,
  setDone,
}: {
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setDone: Dispatch<SetStateAction<string | null>>;
}) {
  const toast = useToast();

  const [pending, setPending] = useState<AdminOrderRow[]>([]);
  const [found, setFound] = useState<Found | null>(null);
  const [customers, setCustomers] = useState<HandoverCustomer[] | null>(null);
  const [activeCustomer, setActiveCustomer] = useState<HandoverCustomer | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [code, setCode] = useState("");
  const [customerQ, setCustomerQ] = useState("");
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminApi.orders({ status: "ARRIVED", pageSize: 100 });
      setPending(list.data);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Ачаалж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [setError, toast]);

  useEffect(() => deferEffect(() => { void loadPending(); }), [loadPending]);

  const resetSelection = () => {
    setSelected(new Set());
  };

  const lookup = useCallback(
    async (raw: string) => {
      setError(null);
      setDone(null);
      setCustomers(null);
      setActiveCustomer(null);
      resetSelection();
      const match = raw.trim().toUpperCase().match(/PH-[A-Z0-9]{6}/);
      const value = match ? match[0] : raw.trim();
      if (!value) return;

      setBusy(true);
      setScanning(false);
      try {
        setFound(await adminApi.handoverLookup(value));
      } catch (e) {
        setFound(null);
        const message = e instanceof ApiError ? e.message : "Хайж чадсангүй.";
        setError(message);
        toast.error(message);
      } finally {
        setBusy(false);
      }
    },
    [setBusy, setDone, setError, toast],
  );

  const searchCustomer = async () => {
    const q = customerQ.trim();
    if (q.length < 2) return;
    setError(null);
    setDone(null);
    setFound(null);
    resetSelection();
    setBusy(true);
    try {
      const list = await adminApi.handoverCustomer(q);
      setCustomers(list);
      setActiveCustomer(list.length === 1 ? list[0]! : null);
      if (list.length === 1) {
        setSelected(new Set(selectableItemIds(list[0]!.items)));
      }
    } catch (e) {
      setCustomers(null);
      setActiveCustomer(null);
      const message = e instanceof ApiError ? e.message : "Хайж чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const openCustomer = (c: HandoverCustomer) => {
    setActiveCustomer(c);
    setSelected(new Set(selectableItemIds(c.items)));
  };

  const dueForSelected = useMemo(() => {
    if (!activeCustomer) return 0;
    const orderDue = new Map<string, number>();
    for (const item of activeCustomer.items) {
      if (!selected.has(item.id) || !item.canPick) continue;
      if (!orderDue.has(item.orderId)) {
        orderDue.set(
          item.orderId,
          shopDueOf({
            isLeasing: item.isLeasing,
            subtotal: item.subtotal,
            dueAmount: item.dueAmount,
            shopDueAmount: item.shopDueAmount,
            leasingDueAmount: item.leasingDueAmount,
            storageFee: item.storageFee,
            paidAmount: item.paidAmount,
          }),
        );
      }
    }
    return [...orderDue.values()].reduce((a, b) => a + b, 0);
  }, [activeCustomer, selected]);

  const selectedItems = useMemo(() => {
    if (!activeCustomer) return [];
    return activeCustomer.items.filter((i) => selected.has(i.id));
  }, [activeCustomer, selected]);

  const pickableSelected = useMemo(
    () => selectedItems.filter((i) => i.canPick),
    [selectedItems],
  );

  const printItems = useMemo(
    () => selectedItems.filter((i) => isReceiptItem(i)),
    [selectedItems],
  );

  const toggleItem = (id: string, checkable: boolean) => {
    if (!checkable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return {
    pending,
    found,
    setFound,
    customers,
    setCustomers,
    activeCustomer,
    setActiveCustomer,
    selected,
    code,
    setCode,
    customerQ,
    setCustomerQ,
    scanning,
    setScanning,
    loading,
    lookup,
    searchCustomer,
    openCustomer,
    loadPending,
    resetSelection,
    dueForSelected,
    pickableSelected,
    printItems,
    toggleItem,
  };
}
