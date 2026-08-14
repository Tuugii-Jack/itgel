import { NextResponse, type NextRequest } from "next/server";

const ADMIN_SESSION_COOKIE = "itgel_admin_session";

/** Env байхгүй үед ч production хост ажиллана. Локал (`localhost`) таарахгүй. */
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

function isShopHost(host: string): boolean {
  return host === SHOP_HOST || host === `www.${SHOP_HOST}`;
}

function isAdminHost(host: string): boolean {
  return host === ADMIN_HOST;
}

function shopOrigin(): string {
  return `https://${SHOP_HOST}`;
}

function adminOrigin(): string {
  return `https://${ADMIN_HOST}`;
}

function hasAdminSession(request: NextRequest): boolean {
  return request.cookies.get(ADMIN_SESSION_COOKIE)?.value === "1";
}

function redirectOnHost(origin: string, pathname: string, search: string) {
  return NextResponse.redirect(new URL(`${origin}${pathname}${search}`), 308);
}

/**
 * Дэлгүүр: itgelshop.mn
 * Админ: admin.itgelshop.mn — `/` шууд админ (нэвтрээгүй бол login).
 * Локал дээр хост таарахгүй тул хуучин /admin зам хэвээр.
 */
export function middleware(request: NextRequest) {
  const host = requestHost(request);
  const { pathname, search } = request.nextUrl;

  if (isShopHost(host) && pathname.startsWith("/admin")) {
    return redirectOnHost(adminOrigin(), pathname, search);
  }

  if (isAdminHost(host)) {
    if (pathname === "/" || pathname === "") {
      const dest = hasAdminSession(request) ? "/admin" : "/admin/login";
      const url = request.nextUrl.clone();
      url.pathname = dest;
      url.search = "";
      return NextResponse.redirect(url);
    }

    if (!pathname.startsWith("/admin")) {
      return redirectOnHost(shopOrigin(), pathname, search);
    }
  }

  if (!pathname.startsWith("/admin")) return NextResponse.next();

  if (pathname === "/admin/login") return NextResponse.next();

  if (!hasAdminSession(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
