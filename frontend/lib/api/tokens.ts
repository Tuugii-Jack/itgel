export const TOKEN_KEYS = {
  customer: "itgel.customer.token",
  admin: "itgel.admin.token",
} as const;

/** Middleware-д унших cookie — JWT биш, зөвхөн «нэвтэрсэн эсэх» тэмдэг. */
export const ADMIN_SESSION_COOKIE = "itgel_admin_session";

export function readToken(kind: keyof typeof TOKEN_KEYS): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEYS[kind]);
}

function syncAdminSessionCookie(token: string | null): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  if (token) {
    document.cookie = `${ADMIN_SESSION_COOKIE}=1; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax${secure}`;
  } else {
    document.cookie = `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${secure}`;
  }
}

export function writeToken(
  kind: keyof typeof TOKEN_KEYS,
  token: string | null,
): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEYS[kind], token);
  else window.localStorage.removeItem(TOKEN_KEYS[kind]);
  if (kind === "admin") syncAdminSessionCookie(token);
}

export function clearStoredTokens(): void {
  writeToken("admin", null);
  writeToken("customer", null);
}
