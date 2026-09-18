/** Зөвшөөрөгдсөн дотоод зам — нээлттэй redirect-оос сэргийлнэ. */
const ALLOWED = [
  /^\/workspace(\/|$)/,
  /^\/profile(\/|$)/,
  /^\/checkout(\/|$)/,
  /^\/cart(\/|$)/,
  /^\/t(\/|$)/,
  /^\/success(\/|$)/,
  /^\/order(\/|$)/,
  /^\/$/,
];

export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const path = raw.trim();
  if (!path.startsWith("/")) return null;
  if (path.startsWith("//") || path.includes("\\") || path.includes("://")) return null;
  const pathname = path.split("?")[0] ?? path;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return null;
  if (pathname === "/leasing" || pathname.startsWith("/leasing/")) return null;
  if (!ALLOWED.some((re) => re.test(pathname))) return null;
  return path;
}

export function workspaceHome(role: string | null | undefined): string {
  if (role === "OWNER") return "/workspace";
  return role === "LEASING" ? "/workspace/leasing" : "/workspace/shop";
}

export function profileLoginPath(next?: string | null): string {
  const safe = safeNextPath(next);
  return safe ? `/profile?next=${encodeURIComponent(safe)}` : "/profile";
}
