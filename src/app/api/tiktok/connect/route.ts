import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { tiktokAuthUrl } from "@/lib/tiktok";
import { isAuthed } from "@/lib/auth";
import { cfg } from "@/lib/config";

/** /api/tiktok/connect?channel=<kanalId>: TikTok izin sayfasına yönlendirir */
export async function GET(req: NextRequest) {
  const { appUrl } = await cfg();
  if (!(await isAuthed())) return NextResponse.redirect(`${appUrl}/login`);
  const channel = req.nextUrl.searchParams.get("channel") ?? "";
  try {
    const state = `${crypto.randomBytes(12).toString("hex")}.${channel}`;
    (await cookies()).set("tt_state", state, { httpOnly: true, sameSite: "lax", maxAge: 900, path: "/" });
    return NextResponse.redirect(await tiktokAuthUrl(state));
  } catch (e) {
    return NextResponse.redirect(`${appUrl}/channels/${channel}?msg=${encodeURIComponent((e as Error).message)}#baglantilar`);
  }
}
