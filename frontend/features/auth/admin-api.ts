import { adminAuth, request } from "@/lib/api/client";

export const adminAuthApi = {
  login: (email: string, password: string) =>
    request<{
      token: string;
      user: { id: string; email: string; name: string; role: string };
    }>("/admin/auth/login", { method: "POST", body: { email, password } }).then(
      (r) => r.data,
    ),

  me: () =>
    request<{ id: string; email: string; name: string; role: string }>(
      "/admin/auth/me",
      adminAuth,
    ).then((r) => r.data),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/admin/auth/password", {
      ...adminAuth,
      method: "POST",
      body: { currentPassword, newPassword },
    }).then((r) => r.data),
};
