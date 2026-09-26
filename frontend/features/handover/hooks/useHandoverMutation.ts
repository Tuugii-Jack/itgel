import type { Dispatch, SetStateAction } from "react";
import { adminApi, ApiError } from "@/lib/api";
import { shopDueOf } from "@/lib/leasing";
import { useToast } from "@/lib/toast";
import type { HandoverCustomer, HandoverCustomerItem, HandoverPayMethod } from "@/lib/types";
import type { Found } from "../utils";

export function useHandoverMutation({
  found,
  setFound,
  activeCustomer,
  setActiveCustomer,
  setCustomers,
  setCode,
  setCustomerQ,
  pickableSelected,
  dueForSelected,
  payMethod,
  loadPending,
  goToDone,
  resetSelection,
  setBusy,
  setError,
  setDone,
}: {
  found: Found | null;
  setFound: Dispatch<SetStateAction<Found | null>>;
  activeCustomer: HandoverCustomer | null;
  setActiveCustomer: Dispatch<SetStateAction<HandoverCustomer | null>>;
  setCustomers: Dispatch<SetStateAction<HandoverCustomer[] | null>>;
  setCode: Dispatch<SetStateAction<string>>;
  setCustomerQ: Dispatch<SetStateAction<string>>;
  pickableSelected: HandoverCustomerItem[];
  dueForSelected: number;
  payMethod: HandoverPayMethod | null;
  loadPending: () => Promise<void>;
  goToDone: () => void;
  resetSelection: () => void;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setDone: Dispatch<SetStateAction<string | null>>;
}) {
  const toast = useToast();

  const markReceived = async (lines?: { itemId: string; qty: number; expectedHandedQty: number }[]) => {
    if (!activeCustomer) return;
    const payload =
      lines && lines.length > 0
        ? lines
        : pickableSelected.map((i) => ({
            itemId: i.id,
            qty: i.pickableQty ?? 1,
            expectedHandedQty: i.handedOverQty ?? 0,
          }));
    if (payload.length === 0) return;
    if (dueForSelected > 0 && !payMethod) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.handoverPartial({
        items: payload,
        collectedAmount: dueForSelected > 0 ? dueForSelected : 0,
        method: dueForSelected > 0 ? (payMethod ?? undefined) : undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      setDone(`${result.pieceCount ?? result.itemCount} ширхэг өгсөн`);
      toast.success(`${result.pieceCount ?? result.itemCount} ширхэг хүлээлгэж өглөө.`);
      setActiveCustomer(null);
      setCustomers(null);
      setCustomerQ("");
      resetSelection();
      await loadPending();
      goToDone();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хүлээлгэн өгч чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const complete = async (lines?: { itemId: string; qty: number; expectedHandedQty: number }[]) => {
    if (!found) return;
    const shopDue = shopDueOf(found);
    if (shopDue > 0 && !payMethod) return;
    const payload =
      lines && lines.length > 0
        ? lines
        : (found.pickableItemIds ?? found.items.filter((i) => (i.pickableQty ?? 0) > 0).map((i) => i.id)).map((itemId) => {
            const item = found.items.find((row) => row.id === itemId);
            return {
              itemId,
              qty: item?.pickableQty ?? 1,
              expectedHandedQty: item?.handedOverQty ?? 0,
            };
          });
    if (payload.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.handoverPartial({
        items: payload,
        collectedAmount: shopDue > 0 ? shopDue : 0,
        method: shopDue > 0 ? (payMethod ?? undefined) : undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      setDone(`${result.pieceCount ?? result.itemCount} ширхэг өгсөн`);
      toast.success(`${found.code} · ${result.pieceCount ?? result.itemCount} ширхэг хүлээлгэж өглөө.`);
      setFound(null);
      setCode("");
      await loadPending();
      goToDone();
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Хүлээлгэн өгч чадсангүй.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return { markReceived, complete };
}
