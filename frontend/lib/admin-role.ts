export function isFullAdmin(role?: string | null): boolean {
  return role === "ADMIN";
}

export function isLeasingAdmin(role?: string | null): boolean {
  return role === "LEASING";
}

/** Туслах админ хандаж болох хуудсууд. */
export function helperAdminCanAccess(pathname: string): boolean {
  if (
    pathname === "/workspace" ||
    pathname === "/workspace/shop" ||
    pathname === "/workspace/shop/account"
  ) {
    return true;
  }
  return (
    pathname.startsWith("/workspace/shop/orders") ||
    pathname.startsWith("/workspace/shop/handover") ||
    pathname.startsWith("/workspace/shop/deliveries") ||
    pathname.startsWith("/workspace/shop/returns") ||
    pathname.startsWith("/workspace/shop/customers")
  );
}

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Админ",
  STAFF: "Туслах админ",
  LEASING: "Лизингийн админ",
};
