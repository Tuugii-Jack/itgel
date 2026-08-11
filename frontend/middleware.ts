import { NextResponse, type NextRequest } from "next/server";

const ADMIN_SESSION_COOKIE = "itgel_admin_session";

/**
 * Админ хэсэг — session cookie байхгүй бол /admin/login руу.
 * Жинхэнэ эрх JWT + backend `requireStaff`-аар баталгаажина.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/admin")) return NextResponse.next();

  const isLogin = pathname === "/admin/login";
  const hasSession = request.cookies.get(ADMIN_SESSION_COOKIE)?.value === "1";

  if (!hasSession && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (hasSession && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
