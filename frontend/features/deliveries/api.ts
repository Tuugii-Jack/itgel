import { adminAuth, request, type Query } from "@/lib/api/client";
import type { AdminDelivery, DeliveryHistory } from "@/types";

export const adminDeliveriesApi = {
  deliveries: (query?: Query) =>
    request<AdminDelivery[]>("/admin/deliveries", { ...adminAuth, query }).then(
      (r) => r.data,
    ),

  deliveryHistory: (year: number, month: number) =>
    request<DeliveryHistory>("/admin/deliveries/history", {
      ...adminAuth,
      query: { year, month },
    }).then((r) => r.data),

  updateDelivery: (
    id: string,
    body: Partial<{ courierName: string | null; status: string }>,
  ) =>
    request<unknown>(`/admin/deliveries/${id}`, {
      ...adminAuth,
      method: "PATCH",
      body,
    }).then((r) => r.data),
};
