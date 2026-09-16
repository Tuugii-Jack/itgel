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

  const markReceived = async () => {
    if (!activeCustomer || pickableSelected.length === 0) return;
    if (dueForSelected > 0 && !payMethod) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.handoverPartial({
        itemIds: pickableSelected.map((i) => i.id),
        collectedAmount: dueForSelected > 0 ? dueForSelected : 0,
        method: dueForSelected > 0 ? (payMethod ?? undefined) : undefined,
      });
      setDone(`${result.itemCount} бараа өгсөн`);
      toast.success(`${result.itemCount} бараа хүлээлгэж өглөө.`);
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

  const complete = async () => {
    if (!found) return;
    const shopDue = shopDueOf(found);
    if (shopDue > 0 && !payMethod) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminApi.handoverComplete(
        found.id,
        shopDue > 0
          ? { collectedAmount: shopDue, method: payMethod ?? "CASH" }
          : { collectedAmount: 0 },
      );
      setDone(result.code);
      toast.success(`${result.code} хүлээлгэж өглөө.`);
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
