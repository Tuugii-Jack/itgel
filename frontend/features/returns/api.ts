import { adminAuth, request } from "@/lib/api/client";
import type { ReturnsCalendar, ReturnsList } from "@/types";

export const adminReturnsApi = {
  returnsCalendar: (year: number, month: number) =>
    request<ReturnsCalendar>("/admin/returns/calendar", {
      ...adminAuth,
      query: { year, month },
    }).then((r) => r.data),

  returns: (days: string[]) =>
    request<ReturnsList>("/admin/returns", {
      ...adminAuth,
      query: { days: days.join(",") },
    }).then((r) => r.data),

  confirmReturnPayouts: (days: string[], customerIds: string[]) =>
    request<ReturnsList>("/admin/returns/payouts", {
      ...adminAuth,
      method: "POST",
      body: { days, customerIds },
    }).then((r) => r.data),
};
