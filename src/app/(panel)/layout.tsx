import type { ReactNode } from "react";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { cfg } from "@/lib/config";
import { updateAvailable } from "@/lib/update";
import { listChannels } from "@/lib/channels";
import { currentChannel } from "@/lib/current-channel";
import { ChannelSwitch } from "@/app/components/ChannelSwitch";
import { Nav } from "@/app/components/Nav";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  await requireAuth();
  const s = await getSettings();
  const c = await cfg();
  const channels = await listChannels();
  const ch = await currentChannel();
  const warnings: string[] = [];
  if (!c.anthropicApiKey) warnings.push("Claude API anahtarı girilmemiş: metin yazımı ve çizim çalışmaz.");
  if (s.imageProvider === "mock") warnings.push("Görsel sağlayıcı \"Deneme\" seçili: sahneler çizim değil, renkli degrade olur.");
  if (s.ttsProvider === "mock") warnings.push("Ses sağlayıcı \"Deneme\" seçili: seslendirme yapılmaz.");
  const update = await updateAvailable();
  const links = [
    { href: "/", label: "Panel" },
    { href: "/calendar", label: ch.contentFormat === "story" ? "Bölümler" : "Takvim" },
    { href: "/clips", label: "Demo klipleri" },
    ...(ch.contentFormat === "promo" ? [{ href: "/sales", label: "Satış videoları" }] : []),
    { href: "/style", label: "Örnek video" },
    { href: `/channels/${ch.id}`, label: "Kanal ayarları" },
  ];
  return (
    <>
      <header style={{ borderBottomColor: ch.primaryColor }}>
        <Link href="/" className="brand">
          Shorts<span>Otomasyon</span>
        </Link>
        <ChannelSwitch channels={channels.map((x) => ({ id: x.id, name: x.name, format: x.contentFormat }))} current={ch.id} />
        <Nav links={links} />
        <div className="navright">
          <Nav links={[{ href: "/channels", label: "Tüm kanallar" }, { href: "/settings", label: "Genel ayarlar" }]} />
        </div>
      </header>
      <main>
        {update && (
          <div className="banner info">
            ✨ Yeni sürüm hazır. Uygulamayı kapatıp proje klasöründeki <b>Guncelle.bat</b> dosyasına çift tıklayın, bitince <b>Baslat.bat</b> ile açın.
          </div>
        )}
        {warnings.length > 0 && (
          <div className="banner warn">
            {warnings.map((w) => (
              <div key={w}>⚠ {w}</div>
            ))}
            <Link href="/settings">Genel ayarlardan düzelt</Link>
          </div>
        )}
        {children}
      </main>
    </>
  );
}
