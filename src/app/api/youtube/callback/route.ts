import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { handleCallback } from "@/lib/youtube";
import { isAuthed } from "@/lib/auth";
import { cfg } from "@/lib/config";

export async function GET(req: NextRequest) {
  const { appUrl } = await cfg();
  if (!(await isAuthed())) return NextResponse.redirect(`${appUrl}/login`);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("yt_state")?.value;
  jar.delete("yt_state");
  try {
    if (!code) throw new Error(req.nextUrl.searchParams.get("error") || "Kod yok");
    if (!state || state !== expected) throw new Error("Geçersiz state, tekrar deneyin");
    await handleCallback(code);
    return NextResponse.redirect(`${appUrl}/?yt=ok`);
  } catch (e) {
    return NextResponse.redirect(`${appUrl}/?yt=err&msg=${encodeURIComponent((e as Error).message)}`);
  }
}
