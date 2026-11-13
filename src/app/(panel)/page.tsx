import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatLocal } from "@/lib/time";
import { disconnectYoutube, quickVideo } from "@/app/actions";
import { STATUS_TR } from "@/app/status";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ yt?: string; msg?: string }> }) {
  const { yt, msg } = await searchParams;
  const s = await getSettings();
  const account = await prisma.youtubeAccount.findUnique({ where: { id: 1 } });
  const counts = await prisma.contentItem.groupBy({ by: ["status"], _count: true });
  const count = (k: string) => counts.find((c) => c.status === k)?._count ?? 0;
  const upcoming = await prisma.contentItem.findMany({
    where: { status: { not: "UPLOADED" }, publishAt: { gte: new Date(Date.now() - 86400_000) } },
    orderBy: { publishAt: "asc" },
    take: 10,
  });
  const recent = await prisma.contentItem.findMany({ where: { status: "UPLOADED" }, orderBy: { publishAt: "desc" }, take: 5 });
  const logs = await prisma.jobLog.findMany({ orderBy: { id: "desc" }, take: 40 });

  return (
    <>
      <h1>Panel</h1>
      {yt === "ok" && <div className="card">YouTube kanalı bağlandı ✓</div>}
      {yt === "err" && <div className="card err">YouTube bağlantısı başarısız: {msg}</div>}

      <div className="card row">
        {account ? (
          <>
            <span>📺 Bağlı kanal: <b>{account.channelTitle}</b></span>
            <form action={disconnectYoutube} style={{ marginLeft: "auto" }}>
              <button className="secondary">Bağlantıyı kes</button>
            </form>
          </>
        ) : (
          <>
            <span>YouTube kanalı bağlı değil.</span>
            <a className="btn" href="/api/youtube/connect" style={{ marginLeft: "auto" }}>YouTube kanalını bağla</a>
          </>
        )}
      </div>

      <form action={quickVideo} className="card">
        <h2 style={{ marginTop: 0 }}>{s.contentFormat === "story" ? "Yeni bölüm üret" : "Yeni video üret"}</h2>
        <div className="row">
          <input
            name="topic"
            placeholder={s.contentFormat === "story" ? "Bu bölüm için not (isteğe bağlı)" : "Konu (isteğe bağlı, boşsa Claude nişten seçer)"}
            style={{ flex: 1, minWidth: 220 }}
          />
          <select name="mode" defaultValue="publish" style={{ width: "auto" }}>
            <option value="publish">Üret ve hemen yayınla</option>
            <option value="review">Üret, önce ben bakayım</option>
          </select>
          <button>Üret</button>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Claude metni yazar, ses ve görseller üretilir, video hazırlanır (birkaç dakika). Otomatik takvim ayrıca çalışmaya devam eder.
        </p>
      </form>

      <div className="card">
        <div className="muted" style={{ marginBottom: 8 }}>
          Niş: <b>{s.niche || "— (Ayarlar'dan girin)"}</b> · Günde {s.videosPerDay} video · Saatler {s.publishTimes} · Ses: {s.ttsProvider} · Görsel: {s.imageProvider} · Otomatik: {s.autoProduce ? "açık" : "kapalı"}
        </div>
        <div className="grid">
          {["DRAFT", "APPROVED", "PRODUCING", "READY", "UPLOADED", "FAILED"].map((k) => (
            <Link key={k} href={`/calendar?f=${k}`} className="stat card" style={{ marginBottom: 0 }}>
              <b>{count(k)}</b>
              <span>{STATUS_TR[k]}</span>
            </Link>
          ))}
        </div>
      </div>

      <h2>Sıradaki videolar</h2>
      <div className="card">
        {upcoming.length === 0 ? (
          <span className="muted">Planlı video yok. <Link href="/calendar">Takvim oluştur</Link></span>
        ) : (
          <table>
            <tbody>
              {upcoming.map((it) => (
                <tr key={it.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatLocal(it.publishAt, s.timezone)}</td>
                  <td><Link href={`/items/${it.id}`}>{it.title}</Link>{it.error && <div className="err">{it.error}</div>}</td>
                  <td><span className={`badge ${it.status}`}>{STATUS_TR[it.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {recent.length > 0 && (
        <>
          <h2>Son yüklenenler</h2>
          <div className="card">
            <table>
              <tbody>
                {recent.map((it) => (
                  <tr key={it.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{formatLocal(it.publishAt, s.timezone)}</td>
                    <td>{it.title}</td>
                    <td><a href={`https://youtube.com/shorts/${it.youtubeVideoId}`} target="_blank">YouTube&apos;da aç</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>İşlem kayıtları</h2>
      <div className="card logs">
        {logs.length === 0 && <span className="muted">Kayıt yok.</span>}
        {logs.map((l) => (
          <div key={l.id} className={l.level}>
            {formatLocal(l.createdAt, s.timezone)} {l.itemId ? <Link href={`/items/${l.itemId}`}>[video]</Link> : ""} {l.message}
          </div>
        ))}
      </div>
    </>
  );
}
