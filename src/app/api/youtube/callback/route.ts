import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { handleCallback } from "@/lib/youtube";

export async function GET(req: NextRequest) {
  const base = process.env.APP_URL || "http://localhost:3000";
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("yt_state")?.value;
  jar.delete("yt_state");
  try {
    if (!code) throw new Error(req.nextUrl.searchParams.get("error") || "Kod yok");
    if (!state || state !== expected) throw new Error("Geçersiz state, tekrar deneyin");
    await handleCallback(code);
    return NextResponse.redirect(`${base}/?yt=ok`);
  } catch (e) {
    return NextResponse.redirect(`${base}/?yt=err&msg=${encodeURIComponent((e as Error).message)}`);
  }
}
