/** Бүтэн админ — каталог, тохиргоо, захиалга засах. */
export function isFullAdmin(role?: string | null): boolean {
  return role === "ADMIN";
}

/** Туслах админ хандаж болох хуудсууд. */
export function helperAdminCanAccess(pathname: string): boolean {
  if (
    pathname === "/admin" ||
    pathname === "/admin/login" ||
    pathname === "/admin/account"
  ) {
    return true;
  }
  return (
    pathname.startsWith("/admin/orders") ||
    pathname.startsWith("/admin/handover") ||
    pathname.startsWith("/admin/deliveries") ||
    pathname.startsWith("/admin/customers")
  );
}

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Админ",
  STAFF: "Туслах админ",
};
