import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, expectedToken } from "@/lib/auth";

async function login(form: FormData) {
  "use server";
  const pw = String(form.get("password") || "");
  if (!process.env.PANEL_PASSWORD || pw !== process.env.PANEL_PASSWORD) redirect("/login?e=1");
  (await cookies()).set(AUTH_COOKIE, await expectedToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_URL || "").startsWith("https"),
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <div className="card" style={{ maxWidth: 360, margin: "60px auto" }}>
      <h1>Giriş</h1>
      {!process.env.PANEL_PASSWORD && <p className="err">.env içinde PANEL_PASSWORD tanımlı değil.</p>}
      {e && <p className="err">Şifre hatalı.</p>}
      <form action={login}>
        <label>Panel şifresi</label>
        <input type="password" name="password" autoFocus />
        <div style={{ marginTop: 12 }}>
          <button>Giriş yap</button>
        </div>
      </form>
    </div>
  );
}
