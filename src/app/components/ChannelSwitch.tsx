"use client";
import { usePathname } from "next/navigation";
import { selectChannel } from "@/app/actions";

/** Üst çubukta kanal seçici: seçim değişince form kendiliğinden gönderilir */
export function ChannelSwitch({ channels, current }: { channels: { id: string; name: string; format: string }[]; current: string }) {
  const pathname = usePathname();
  return (
    <form action={selectChannel} className="switch">
      <input type="hidden" name="back" value={pathname} />
      <span className="muted">Kanal:</span>
      <select name="channel" defaultValue={current} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} · {c.format === "promo" ? "ürün tanıtımı" : c.format === "story" ? "hikâye dizisi" : "bilgi"}
          </option>
        ))}
      </select>
      <noscript><button className="secondary">Seç</button></noscript>
    </form>
  );
}
