import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cfg } from "./config";

export const AUTH_COOKIE = "panel_auth";

export async function tokenFor(pw: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`shorts-panel:${pw}`));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Şifre ayarlıysa oturum çerezini doğrular. Şifre yoksa (yerel kullanım) herkese açık. */
export async function isAuthed(): Promise<boolean> {
  const { panelPassword } = await cfg();
  if (!panelPassword) return true;
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  return token === (await tokenFor(panelPassword));
}

export async function requireAuth() {
  if (!(await isAuthed())) redirect("/login");
}

export async function setAuthCookie(pw: string) {
  (await cookies()).set(AUTH_COOKIE, await tokenFor(pw), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}
