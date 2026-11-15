import Link from "next/link";
import { prisma } from "@/lib/db";
import { listChannels } from "@/lib/channels";
import { createChannel, seedBefwareChannels } from "@/app/actions";

export const dynamic = "force-dynamic";

const FORMAT_TR: Record<string, string> = { info: "Bilgi videosu", story: "Hikâye dizisi", promo: "Ürün tanıtımı" };

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ seeded?: string }> }) {
  const { seeded } = await searchParams;
  const channels = await listChannels();
  const conns = await prisma.connection.findMany({ select: { channelId: true, platform: true, accountName: true } });
  const counts = await prisma.contentItem.groupBy({ by: ["channelId"], _count: true });
  const hasBefware = channels.some((c) => c.productName === "Randıman") && channels.some((c) => c.productName === "Asistena");

  return (
    <>
      <h1>Kanallar</h1>
      {seeded && <div className="card">Randıman ve Asistena kanalları eklendi ✓ Ürün adresini ve gerçek özellikleri kanal ayarlarından tamamlayın.</div>}
      <p className="muted">
        Her kanalın kendi konusu, rengi, logosu, yayın saatleri ve YouTube / TikTok / Instagram hesapları vardır. Otomatik üretim her kanal için ayrı çalışır.
      </p>
      <div className="chgrid">
        {channels.map((c) => {
          const cc = conns.filter((x) => x.channelId === c.id);
          const on = (p: string) => cc.some((x) => x.platform === p);
          return (
            <Link key={c.id} href={`/channels/${c.id}`} className="card chcard" style={{ borderTopColor: c.primaryColor, color: "inherit" }}>
              <div className="row">
                {c.logoPath && <img src={`/api/media/brand/${c.id}.png?v=${c.updatedAt.getTime()}`} alt="" />}
                <b style={{ fontSize: 17 }}>{c.name}</b>
              </div>
              <div className="muted" style={{ margin: "6px 0" }}>
                {FORMAT_TR[c.contentFormat] ?? c.contentFormat} · {counts.find((x) => x.channelId === c.id)?._count ?? 0} video · otomatik {c.autoProduce ? "açık" : "kapalı"}
              </div>
              <div>
                <span className={`pill ${on("youtube") ? "on" : ""}`}>YouTube {on("youtube") ? "✓" : "—"}</span>
                <span className={`pill ${on("tiktok") ? "on" : ""}`}>TikTok {on("tiktok") ? "✓" : "—"}</span>
                <span className={`pill ${on("instagram") ? "on" : ""}`}>Instagram {on("instagram") ? "✓" : "—"}</span>
              </div>
            </Link>
          );
        })}
      </div>

      <form action={createChannel} className="card">
        <h2 style={{ marginTop: 0 }}>Yeni kanal</h2>
        <div className="row">
          <input name="name" placeholder="Kanal adı (ör. Mimar Not)" style={{ flex: 1, minWidth: 200 }} />
          <select name="contentFormat" defaultValue="promo" style={{ width: "auto" }}>
            <option value="promo">Ürün tanıtımı</option>
            <option value="info">Bilgi videosu</option>
            <option value="story">Hikâye dizisi</option>
          </select>
          <button>Oluştur</button>
        </div>
      </form>

      {!hasBefware && (
        <form action={seedBefwareChannels} className="card">
          <h2 style={{ marginTop: 0 }}>Befware hazır profilleri</h2>
          <p className="muted">
            Portföy belgesindeki önceliğe göre <b>Randıman</b> ve <b>Asistena</b> için ürün tanıtımı kanalları oluşturur (sorun, hedef kitle, renkler,
            Asistena için satış sektörleri). Belgede olmayan bilgiler uydurulmaz; ürün adresi ve özellikleri siz tamamlarsınız.
          </p>
          <button>Randıman ve Asistena kanallarını ekle</button>
        </form>
      )}
    </>
  );
}
