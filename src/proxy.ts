import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Pengecekan optimistik saja: ada cookie sesi atau tidak. Validasi sesi & permission sungguhan
 * dilakukan di API (middleware Hono) dan saat render halaman. Lihat docs/ARCHITECTURE.md §5.
 */
const PUBLIC_PAGES = new Set(["/login", "/forgot-password", "/reset-password"]);

export function proxy(request: NextRequest) {
  const hasSession = Boolean(getSessionCookie(request));
  const { pathname, search } = request.nextUrl;

  // /login tidak di-redirect walau ada cookie: cookie bisa saja kedaluwarsa, dan redirect di sini akan berputar.
  if (PUBLIC_PAGES.has(pathname)) return NextResponse.next();
  if (!hasSession) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  if (pathname === "/") return NextResponse.redirect(new URL("/dashboard", request.url));
  return NextResponse.next();
}

export const config = {
  // Semua halaman kecuali API, aset Next, dan file statis.
  matcher: ["/((?!api|\.well-known|_next/static|_next/image|favicon.ico|.*\.[a-zA-Z0-9]+$).*)"],
};
