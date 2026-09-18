import { NextResponse, type NextRequest } from "next/server";
import { profileLoginPath } from "./lib/safeNext";

const ADMIN_SESSION_COOKIE = "itgel_admin_session";

const SHOP_HOST = (
  process.env.NEXT_PUBLIC_SHOP_HOST || "itgelshop.mn"
).toLowerCase();
const ADMIN_HOST = (
  process.env.NEXT_PUBLIC_ADMIN_HOST || "admin.itgelshop.mn"
).toLowerCase();

function requestHost(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-host");
  const raw = forwarded ?? request.headers.get("host") ?? request.nextUrl.hostname;
  return raw.split(",")[0].trim().split(":")[0].toLowerCase();
}

function isAdminHost(host: string): boolean {
  return host === ADMIN_HOST;
}

function shopOrigin(): string {
  return `https://${SHOP_HOST}`;
}

function redirectOnHost(origin: string, pathname: string, search: string) {
  return NextResponse.redirect(new URL(`${origin}${pathname}${search}`), 308);
}

function hasWorkspaceSession(request: NextRequest): boolean {
  return request.cookies.get(ADMIN_SESSION_COOKIE)?.value === "1";
}

function isRetiredStaffPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/leasing" ||
    pathname.startsWith("/leasing/")
  );
}

/**
 * Дэлгүүр: itgelshop.mn
 * Удирдлага: /workspace. Хуучин /admin, /leasing — 404, шинэ замыг илчлэхгүй.
 */
export function middleware(request: NextRequest) {
  const host = requestHost(request);
  const { pathname, search } = request.nextUrl;

  if (isRetiredStaffPath(pathname)) {
    return NextResponse.next();
  }

  if (isAdminHost(host)) {
    if (pathname === "/" || pathname === "") {
      const url = request.nextUrl.clone();
      url.pathname = "/workspace";
      url.search = "";
      return NextResponse.redirect(url);
    }
    if (!pathname.startsWith("/workspace")) {
      return redirectOnHost(shopOrigin(), pathname, search);
    }
  }

  if (pathname.startsWith("/workspace") && !hasWorkspaceSession(request)) {
    const dest = profileLoginPath(`${pathname}${search}`);
    if (isAdminHost(host)) {
      return NextResponse.redirect(new URL(`${shopOrigin()}${dest}`));
    }
    const url = request.nextUrl.clone();
    const [path, query] = dest.split("?");
    url.pathname = path || "/profile";
    url.search = query ? `?${query}` : "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
