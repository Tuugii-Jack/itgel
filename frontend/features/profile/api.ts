import { request } from "@/lib/api/client";
import type { Me, MyOrder, PageMeta } from "@/types";

export const shopProfileApi = {
  me: () => request<Me>("/me", { auth: "customer" }).then((r) => r.data),

  updateMe: (
    body: Partial<{
      name: string | null;
      district: string | null;
      khoroo: string | null;
      addressText: string | null;
      notifyPayment: boolean;
      notifyArrival: boolean;
      notifyPromo: boolean;
      bankName: string | null;
      bankAccountNumber: string | null;
      bankAccountName: string | null;
      defaultPayoutBank: boolean;
    }>,
    token?: string,
  ) =>
    request<Me>("/me", {
      method: "PATCH",
      body,
      auth: "customer",
      bearer: token,
    }).then((r) => r.data),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<Me>("/me/password", {
      method: "POST",
      body: { currentPassword, newPassword },
      auth: "customer",
    }).then((r) => r.data),

  changeEmail: (email: string, password?: string) =>
    request<{
      email: string;
      expiresInSec: number;
      resendAfterSec: number;
      message?: string;
    }>("/me/email/change", {
      method: "POST",
      body: { email, ...(password ? { password } : {}) },
      auth: "customer",
    }).then((r) => r.data),

  changePhone: (phone: string) =>
    request<{
      phone: string;
      expiresInSec: number;
      resendAfterSec: number;
      smsStatus?: string;
      message?: string;
    }>("/me/phone/change", {
      method: "POST",
      body: { phone },
      auth: "customer",
    }).then((r) => r.data),

  resendPhoneChange: (phone: string) =>
    request<{
      phone: string;
      expiresInSec: number;
      resendAfterSec: number;
      smsStatus?: string;
    }>("/me/phone/resend", {
      method: "POST",
      body: { phone },
      auth: "customer",
    }).then((r) => r.data),

  verifyPhoneChange: (phone: string, code: string) =>
    request<{
      token: string;
      customer: Me;
    }>("/me/phone/verify", {
      method: "POST",
      body: { phone, code },
      auth: "customer",
    }).then((r) => r.data),

  myOrders: () =>
    request<MyOrder[]>("/me/orders", {
      auth: "customer",
    }) as unknown as Promise<{
      data: MyOrder[];
      meta: PageMeta & { totalSpent: number; activeCount: number };
    }>,
};
