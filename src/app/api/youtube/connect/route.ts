import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { authUrl } from "@/lib/youtube";
import { isAuthed } from "@/lib/auth";
import { cfg } from "@/lib/config";

export async function GET() {
  const { appUrl } = await cfg();
  if (!(await isAuthed())) return NextResponse.redirect(`${appUrl}/login`);
  try {
    const state = crypto.randomBytes(16).toString("hex");
    (await cookies()).set("yt_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
    return NextResponse.redirect(await authUrl(state));
  } catch (e) {
    return NextResponse.redirect(`${appUrl}/?yt=err&msg=${encodeURIComponent((e as Error).message)}`);
  }
}
