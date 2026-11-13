import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { authUrl } from "@/lib/youtube";

export async function GET() {
  try {
    const state = crypto.randomBytes(16).toString("hex");
    (await cookies()).set("yt_state", state, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
    return NextResponse.redirect(authUrl(state));
  } catch (e) {
    const base = process.env.APP_URL || "http://localhost:3000";
    return NextResponse.redirect(`${base}/?yt=err&msg=${encodeURIComponent((e as Error).message)}`);
  }
}
