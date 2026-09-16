import { request } from "@/lib/api/client";

export const shopAuthApi = {
  sendOtp: (phone: string) =>
    request<{
      phone: string;
      expiresInSec: number;
      resendAfterSec: number;
      smsStatus?: string;
    }>("/auth/otp", {
      method: "POST",
      body: { phone },
    }).then((r) => r.data),

  verifyOtp: (phone: string, code: string) =>
    request<{
      token: string;
      customer: {
        id: string;
        phone: string | null;
        name: string | null;
        email: string | null;
      };
    }>("/auth/verify", {
      method: "POST",
      body: { phone, code },
    }).then((r) => r.data),

  register: (body: {
    email: string;
    password: string;
    name?: string;
    phone?: string;
  }) =>
    request<{
      token: string;
      customer: {
        id: string;
        email: string;
        phone: string | null;
        name: string | null;
        emailVerified: boolean;
        hasPassword: boolean;
      };
    }>("/auth/register", { method: "POST", body }).then((r) => r.data),

  login: (login: string, password: string) =>
    request<{
      token: string;
      customer: {
        id: string;
        email: string;
        phone: string | null;
        name: string | null;
        emailVerified: boolean;
        hasPassword: boolean;
      };
    }>("/auth/login", { method: "POST", body: { login, password } }).then(
      (r) => r.data,
    ),

  verifyEmail: (email: string, code: string) =>
    request<{
      token: string;
      customer: {
        id: string;
        email: string;
        phone: string | null;
        name: string | null;
        emailVerified: boolean;
        hasPassword: boolean;
      };
    }>("/auth/email/verify", { method: "POST", body: { email, code } }).then(
      (r) => r.data,
    ),

  resendEmailCode: (email: string) =>
    request<{
      email: string;
      expiresInSec: number;
      resendAfterSec: number;
    }>("/auth/email/resend", { method: "POST", body: { email } }).then(
      (r) => r.data,
    ),

  forgotPassword: (email: string) =>
    request<{
      email: string;
      expiresInSec: number;
      resendAfterSec: number;
      message?: string;
    }>("/auth/password/forgot", { method: "POST", body: { email } }).then(
      (r) => r.data,
    ),

  resetPassword: (email: string, code: string, password: string) =>
    request<{
      token: string;
      customer: {
        id: string;
        email: string;
        phone: string | null;
        name: string | null;
        emailVerified: boolean;
        hasPassword: boolean;
      };
    }>("/auth/password/reset", {
      method: "POST",
      body: { email, code, password },
    }).then((r) => r.data),
};
