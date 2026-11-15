import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentChannel } from "@/lib/current-channel";
import { makeSalesVideos } from "@/app/actions";
import { STATUS_TR } from "@/app/status";

export const dynamic = "force-dynamic";

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ started?: string }> }) {
  const { started } = await searchParams;
  const ch = await currentChannel();
  const items = await prisma.contentItem.findMany({ where: { channelId: ch.id, kind: "sales" }, orderBy: { createdAt: "desc" }, take: 60 });
  const busy = items.some((c) => ["WRITING", "APPROVED", "PRODUCING"].includes(c.status));
  const sectors = ch.sectors.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const ready = !!ch.productName && !!ch.productProblem;

  return (
    <>
      <h1>Satış videoları · {ch.name}</h1>
      {busy && <meta httpEquiv="refresh" content="12" />}
      {started && <div className="card">Üretim başladı. Her sektör için video birkaç dakikada hazır olur; sayfa kendini yeniler.</div>}
      <p className="muted">
        Satış ekibinin müşteriye WhatsApp veya e-postayla gönderebileceği, sektöre özel 25-35 saniyelik videolar. Bunlar otomatik yayınlanmaz;
        MP4&apos;ü indirip hazır mesajla birlikte gönderin.
      </p>
      {!ready ? (
        <div className="card err">
          Önce <Link href={`/channels/${ch.id}`}>kanal ayarlarında</Link> formatı &quot;Ürün tanıtımı&quot; yapıp ürün adı ve çözdüğü sorunu girin.
        </div>
      ) : (
        <form action={makeSalesVideos} className="card">
          <label style={{ marginTop: 0 }}>Sektörler (virgülle veya satır satır, en fazla 12)</label>
          <textarea name="sectors" defaultValue={sectors.join("\n")} style={{ minHeight: 120 }} />
          <div className="row" style={{ marginTop: 10 }}>
            <button disabled={busy}>Her sektör için video üret</button>
            <span className="muted">Varsayılan liste <Link href={`/channels/${ch.id}`}>kanal ayarlarından</Link> değiştirilebilir.</span>
          </div>
        </form>
      )}

      {items.map((it) => (
        <div key={it.id} className="card">
          <div className="row">
            <span className={`badge ${it.status}`}>{STATUS_TR[it.status]}</span>
            <b>{it.sector}</b>
            <Link href={`/items/${it.id}`}>{it.title}</Link>
            {it.progress && <span className="muted">⏳ {it.progress}</span>}
            {it.videoPath && (
              <a className="btn secondary" style={{ marginLeft: "auto" }} href={`/api/media/${it.id}/short.mp4?download=1`}>MP4 indir</a>
            )}
          </div>
          {it.error && <div className="err">{it.error}</div>}
          {it.shareText && (
            <>
              <label>Müşteriye gönderilecek mesaj</label>
              <textarea className="sharebox" readOnly defaultValue={it.shareText} />
            </>
          )}
        </div>
      ))}
    </>
  );
}
