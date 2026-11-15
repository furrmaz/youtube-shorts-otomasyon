import type { ReactNode } from "react";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { updateAvailable } from "@/lib/update";
import { listChannels } from "@/lib/channels";
import { currentChannel } from "@/lib/current-channel";
import { ChannelSwitch } from "@/app/components/ChannelSwitch";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  await requireAuth();
  const s = await getSettings();
  const channels = await listChannels();
  const ch = await currentChannel();
  const warnings: string[] = [];
  if (s.imageProvider === "mock") warnings.push("Görsel sağlayıcı \"Deneme\" seçili: sahneler çizim değil, renkli degrade olur.");
  if (s.ttsProvider === "mock") warnings.push("Ses sağlayıcı \"Deneme\" seçili: seslendirme yapılmaz.");
  const update = await updateAvailable();
  return (
    <>
      <div className="channelbar" style={{ borderColor: ch.primaryColor }}>
        <ChannelSwitch channels={channels.map((c) => ({ id: c.id, name: c.name, format: c.contentFormat }))} current={ch.id} />
        <Link href={`/channels/${ch.id}`}>Bu kanalın ayarları</Link>
        <Link href="/channels">Tüm kanallar</Link>
      </div>
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
          <Link href="/settings">Ayarlar&apos;dan değiştir</Link>
        </div>
      )}
      {children}
    </>
  );
}
