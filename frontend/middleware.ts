import { NextResponse, type NextRequest } from "next/server";

const ADMIN_SESSION_COOKIE = "itgel_admin_session";

/**
 * Админ хэсэг — session cookie байхгүй бол /admin/login руу.
 * Login хуудсыг cookie-гоор ХЭЗЭЭ Ч бүү хаа: cookie үлдсэн ч JWT байхгүй
 * үед дахин нэвтрэх боломжгүй болдог байсан.
 * Жинхэнэ эрх JWT + backend `requireStaff`-аар баталгаажина.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
  matcher: ["/admin", "/admin/:path*"],
};
