/** Админ GET кэш — зөвхөн лавлах. Өр/төлбөр/захиалга энд орохгүй. */
export function catalogCacheTtlMs(path: string, auth?: string): number {
  if (auth !== "admin") return 0;
  if (path === "/leasing/products/categories" || path === "/admin/categories") return 30_000;
  if (path === "/leasing/products" || path === "/admin/products") return 8_000;
  return 0;
}

export function adminMemoGetKey(token: string, path: string, query = ""): string {
  return `GET:admin:${token}:${path}${query}`;
}

export function isAdminCatalogWritePath(path: string): boolean {
  return path.includes("/products") || path.includes("/categories");
}

export function isAdminCatalogMemoKey(key: string): boolean {
  if (!key.startsWith("GET:admin:")) return false;
  return (
    key.includes("/leasing/products") ||
    key.includes("/admin/products") ||
    key.includes("/leasing/products/categories") ||
    key.includes("/admin/categories")
  );
}
