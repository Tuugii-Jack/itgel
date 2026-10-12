export function isAdminRole(role?: string | null): boolean {
  return role === "ADMIN" || role === "STAFF" || role === "LEASING" || role === "OWNER";
}

export function isOwner(role?: string | null): boolean {
  return role === "OWNER";
}

export function isFullAdmin(role?: string | null): boolean {
  return role === "ADMIN" || role === "OWNER";
}

export function isLeasingAdmin(role?: string | null): boolean {
  return role === "LEASING" || role === "OWNER";
}

export function canAccessShopPortal(role?: string | null): boolean {
  return role === "ADMIN" || role === "STAFF" || role === "OWNER";
}

export function canAccessLeasingPortal(role?: string | null): boolean {
  return role === "LEASING" || role === "OWNER";
}

export function canWriteLeasingMoney(role?: string | null): boolean {
  return role === "LEASING" || role === "OWNER";
}

/** Туслах админ хандаж болох хуудсууд. */
export function helperAdminCanAccess(pathname: string): boolean {
  if (pathname === "/workspace/shop/orders/new" || pathname.startsWith("/workspace/shop/orders/new/")) return false;
  if (
    pathname === "/workspace" ||
    pathname === "/workspace/shop" ||
    pathname === "/workspace/shop/today" ||
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
  OWNER: "Эзэмшигч",
};

export const WORKSPACE_SECTIONS = [
  { id: "shop", href: "/workspace/shop", label: "Үндсэн админ" },
  { id: "leasing", href: "/workspace/leasing", label: "Лизингийн админ" },
  { id: "store", href: "/", label: "Дэлгүүр" },
] as const;

export type WorkspaceDestination = (typeof WORKSPACE_SECTIONS)[number]["id"];

export function destinationsFor(
  role?: string | null,
  destinations?: string[] | null,
): WorkspaceDestination[] {
  const allowed: WorkspaceDestination[] = role === "OWNER" ? ["shop", "leasing", "store"]
    : role === "LEASING" ? ["leasing"] : role === "ADMIN" || role === "STAFF" ? ["shop"] : [];
  return destinations?.length ? allowed.filter((id) => destinations.includes(id)) : allowed;
}

export function canAccessWorkspacePage(portal: "shop" | "leasing", role: string | null | undefined, pathname: string): boolean {
  return portal === "leasing" ? canAccessLeasingPortal(role)
    : isFullAdmin(role) || (role === "STAFF" && helperAdminCanAccess(pathname));
}

export function workspaceSectionsFor(role?: string | null, destinations?: string[] | null) {
  const ids = destinationsFor(role, destinations);
  return WORKSPACE_SECTIONS.filter((section) => ids.includes(section.id));
}
