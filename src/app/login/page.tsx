import { redirect } from "next/navigation";
import { cfg } from "@/lib/config";
import { setAuthCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function login(form: FormData) {
  "use server";
  const { panelPassword } = await cfg();
  const pw = String(form.get("password") || "");
  if (panelPassword && pw !== panelPassword) redirect("/login?e=1");
  await setAuthCookie(panelPassword);
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  const { panelPassword } = await cfg();
  if (!panelPassword) redirect("/");
  return (
    <div className="card" style={{ maxWidth: 360, margin: "60px auto" }}>
      <h1>Giriş</h1>
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
