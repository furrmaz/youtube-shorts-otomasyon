import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { authUrl } from "@/lib/youtube";
import { isAuthed } from "@/lib/auth";
import { cfg } from "@/lib/config";

/** /api/youtube/connect?channel=<kanalId> */
export async function GET(req: NextRequest) {
  const { appUrl } = await cfg();
  if (!(await isAuthed())) return NextResponse.redirect(`${appUrl}/login`);
  const channel = req.nextUrl.searchParams.get("channel") ?? "";
  try {
    const state = `${crypto.randomBytes(16).toString("hex")}.${channel}`;
    (await cookies()).set("yt_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
    return NextResponse.redirect(await authUrl(state));
  } catch (e) {
    return NextResponse.redirect(`${appUrl}/channels/${channel}?yt=err&msg=${encodeURIComponent((e as Error).message)}`);
  }
}
