import { request } from "@/lib/api/client";
import type { Slot } from "@/types";

export const shopCheckoutApi = {
  slots: (days = 14) =>
    request<{ slots: Slot[]; districts: { district: string; fee: number }[] }>(
      "/delivery/slots",
      { query: { days } },
    ).then((r) => r.data),
};
