import { useState } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";

export function useNotificationToggles() {
  const session = useSession();
  const toast = useToast();
  const me = session.me!;
  const [notif, setNotif] = useState(me.notifications);

  const toggle = async (
    key: "notifyPayment" | "notifyArrival" | "notifyPromo",
    field: "payment" | "arrival" | "promo",
    value: boolean,
  ) => {
    const prev = notif;
    setNotif({ ...notif, [field]: value });
    try {
      await api.updateMe({ [key]: value });
      void session.refresh();
      toast.success("Тохиргоо хадгалагдлаа.");
    } catch {
      setNotif(prev);
      toast.error("Тохиргоог хадгалж чадсангүй. Дахин оролдоно уу.");
    }
  };

  return { notif, toggle };
}
