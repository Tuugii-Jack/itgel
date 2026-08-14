import { NextResponse, type NextRequest } from "next/server";

const ADMIN_SESSION_COOKIE = "itgel_admin_session";

const SHOP_HOST = (process.env.NEXT_PUBLIC_SHOP_HOST ?? "").toLowerCase();
const ADMIN_HOST = (process.env.NEXT_PUBLIC_ADMIN_HOST ?? "").toLowerCase();

function requestHost(request: NextRequest): string {
  return (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
}

function isShopHost(host: string): boolean {
  if (!SHOP_HOST) return false;
  return host === SHOP_HOST || host === `www.${SHOP_HOST}`;
}

function isAdminHost(host: string): boolean {
  return Boolean(ADMIN_HOST) && host === ADMIN_HOST;
}

function shopOrigin(): string {
  return `https://${SHOP_HOST}`;
}

function adminOrigin(): string {
  return `https://${ADMIN_HOST}`;
}

/**
 * Дэлгүүр: itgelshop.mn
 * Админ: admin.itgelshop.mn (/admin).
 * Локал дээр хост env байхгүй тул хуучин /admin зам хэвээр.
 */
export function middleware(request: NextRequest) {
  const host = requestHost(request);
  const { pathname, search } = request.nextUrl;

  if (isShopHost(host) && pathname.startsWith("/admin")) {
    return NextResponse.redirect(new URL(`${adminOrigin()}${pathname}${search}`), 308);
  }

  if (isAdminHost(host)) {
    if (pathname === "/" || pathname === "") {
      const url = request.nextUrl.clone();
      url.pathname = "/admin";
      return NextResponse.redirect(url);
    }

    if (!pathname.startsWith("/admin")) {
      if (!SHOP_HOST) return NextResponse.next();
      return NextResponse.redirect(new URL(`${shopOrigin()}${pathname}${search}`), 308);
    }
  }

  if (!pathname.startsWith("/admin")) return NextResponse.next();

  const isLogin = pathname === "/admin/login";
  if (isLogin) return NextResponse.next();

  const hasSession = request.cookies.get(ADMIN_SESSION_COOKIE)?.value === "1";
  if (!hasSession) {
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
