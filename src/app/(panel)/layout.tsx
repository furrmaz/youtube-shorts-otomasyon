import type { ReactNode } from "react";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  await requireAuth();
  const s = await getSettings();
  const warnings: string[] = [];
  if (s.imageProvider === "mock") warnings.push("Görsel sağlayıcı \"Deneme\" seçili: sahneler çizim değil, renkli degrade olur.");
  if (s.ttsProvider === "mock") warnings.push("Ses sağlayıcı \"Deneme\" seçili: seslendirme yapılmaz.");
  return (
    <>
      {warnings.length > 0 && (
        <div style={{ background: "#3a2a10", border: "1px solid #a8741a", color: "#ffd27a", padding: "10px 16px", borderRadius: 10, margin: "12px auto", maxWidth: 1100, fontSize: 14 }}>
          {warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
          <Link href="/settings" style={{ color: "#ffd27a", textDecoration: "underline" }}>Ayarlar'dan değiştir</Link>
        </div>
      )}
      {children}
    </>
  );
}
