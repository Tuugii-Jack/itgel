import { adminAuth, request } from "@/lib/api/client";

export type WorkspaceGrant = {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    destinations?: string[];
    loginPhones?: string[];
  };
};

export const adminAuthApi = {
  me: () =>
    request<{
      id: string;
      email: string;
      name: string;
      role: string;
      hasLoginPhone?: boolean;
      loginPhones?: string[];
      destinations?: string[];
    }>("/admin/auth/me", adminAuth).then((r) => r.data),

  logout: () =>
    request<{ ok: boolean }>("/admin/auth/logout", {
      ...adminAuth,
      method: "POST",
    }).then((r) => r.data),

  issueLoginPhoneOtp: (phone: string, adminId?: string) =>
    request<{
      phone: string;
      expiresInSec: number;
      resendAfterSec: number;
      smsStatus?: string;
    }>("/admin/auth/login-phone/otp", {
      ...adminAuth,
      method: "POST",
      body: { phone, ...(adminId ? { adminId } : {}) },
    }).then((r) => r.data),

  verifyLoginPhone: (phone: string, code: string, adminId?: string) =>
    request<{
      id: string;
      email: string;
      name: string;
      role: string;
      hasLoginPhone: boolean;
      loginPhones?: string[];
    }>("/admin/auth/login-phone/verify", {
      ...adminAuth,
      method: "POST",
      body: { phone, code, ...(adminId ? { adminId } : {}) },
    }).then((r) => r.data),
};
