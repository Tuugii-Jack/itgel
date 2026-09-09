export function isFullAdmin(role?: string | null): boolean {
  return role === "ADMIN";
}

export function isLeasingAdmin(role?: string | null): boolean {
  return role === "LEASING";
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
    pathname.startsWith("/admin/returns") ||
    pathname.startsWith("/admin/customers")
  );
}

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Админ",
  STAFF: "Туслах админ",
  LEASING: "Лизингийн админ",
};
