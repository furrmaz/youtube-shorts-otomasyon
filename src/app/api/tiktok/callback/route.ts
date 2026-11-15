import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { tiktokConnect } from "@/lib/tiktok";
import { isAuthed } from "@/lib/auth";
import { cfg } from "@/lib/config";

/** TikTok dönüşü (yönlendirme adresi bu uygulamaya ulaşabiliyorsa; yoksa adres panelde elle yapıştırılır) */
export async function GET(req: NextRequest) {
  const { appUrl } = await cfg();
  if (!(await isAuthed())) return NextResponse.redirect(`${appUrl}/login`);
  const q = req.nextUrl.searchParams;
  const jar = await cookies();
  const expected = jar.get("tt_state")?.value;
  jar.delete("tt_state");
  const state = q.get("state") ?? "";
  const channel = state.split(".")[1] ?? "";
  const to = (k: string, v: string) => NextResponse.redirect(`${appUrl}/channels/${channel}?${k}=${encodeURIComponent(v)}#baglantilar`);
  try {
    const code = q.get("code");
    if (!code) throw new Error(q.get("error_description") || q.get("error") || "Kod yok");
    if (!state || state !== expected || !channel) throw new Error("Geçersiz state, tekrar deneyin");
    return to("ok", `TikTok bağlandı: ${await tiktokConnect(channel, code)}`);
  } catch (e) {
    return to("msg", (e as Error).message);
  }
}
