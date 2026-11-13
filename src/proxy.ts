import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, expectedToken } from "./lib/auth";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login")) return NextResponse.next();
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (process.env.PANEL_PASSWORD && token === (await expectedToken())) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
