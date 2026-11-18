import Link from "next/link";
import { prisma } from "@/lib/db";
import { channelSettings } from "@/lib/channels";
import { currentChannel } from "@/lib/current-channel";
import { formatLocal } from "@/lib/time";
import { quickVideo, refreshStatsNow } from "@/app/actions";
import { STATUS_TR, cleanTitle, friendlyError } from "@/app/status";
import { cfg } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const ch = await currentChannel();
  const s = await channelSettings(ch.id);
  const cid = ch.id;
  const conns = await prisma.connection.findMany({ where: { channelId: cid } });
  const account = conns.find((c) => c.platform === "youtube");
  const counts = await prisma.contentItem.groupBy({ by: ["status"], where: { channelId: cid }, _count: true });
  const count = (k: string) => counts.find((c) => c.status === k)?._count ?? 0;
  const upcoming = await prisma.contentItem.findMany({
    // Gelecek planlar + tarihi geçmiş olsa da bekleyen (hazır, hatalı, işlemde) videolar
    where: {
      channelId: cid,
      status: { not: "UPLOADED" },
      OR: [
        { publishAt: { gte: new Date(Date.now() - 86400_000) } },
        { status: { in: ["READY", "FAILED", "WRITING", "PRODUCING", "UPLOADING"] } },
      ],
    },
    orderBy: { publishAt: "asc" },
    take: 15,
  });
  const recent = await prisma.contentItem.findMany({ where: { channelId: cid, status: "UPLOADED" }, orderBy: { publishAt: "desc" }, take: 5 });
  const since30 = new Date(Date.now() - 30 * 86400_000);
  const agg = await prisma.contentItem.aggregate({
    where: { channelId: cid, status: "UPLOADED", publishAt: { gte: since30 }, views: { not: null } },
    _sum: { views: true, likes: true, comments: true },
    _avg: { views: true },
    _count: true,
  });
  const top = await prisma.contentItem.findMany({
    where: { channelId: cid, views: { not: null } },
    orderBy: { views: "desc" },
    take: 5,
  });
  const fmt = (n: number | null | undefined) => Math.round(n ?? 0).toLocaleString("tr-TR");
  const logs = await prisma.jobLog.findMany({
    where: { OR: [{ item: { channelId: cid } }, { itemId: null }] },
    orderBy: { id: "desc" },
    take: 40,
  });
  const k = await cfg();
  const setup = [
    { ok: !!k.anthropicApiKey, label: "Claude API anahtarı", href: "/settings#anahtarlar" },
    { ok: s.ttsProvider === "elevenlabs" && !!k.elevenApiKey, label: "ElevenLabs anahtarı ve seslendirme \"ElevenLabs\"", href: "/settings#anahtarlar" },
    { ok: s.ttsProvider !== "elevenlabs" || !!ch.elevenVoiceId, label: "Bu kanal için ses seçimi", href: `/channels/${cid}` },
    { ok: s.imageProvider !== "mock", label: "Görsel sağlayıcı (Claude çizimi önerilir)", href: "/settings" },
    {
      ok: ch.contentFormat === "promo" ? !!(ch.productName && ch.productProblem) : ch.contentFormat === "story" ? true : !!ch.niche,
      label: ch.contentFormat === "promo" ? "Ürün bilgileri" : "Kanal konusu (niş)",
      href: `/channels/${cid}`,
    },
    { ok: conns.some((c) => c.platform === "youtube") || (!ch.toYoutube && conns.length > 0), label: "Yayın hesabı bağlantısı (YouTube / TikTok / Instagram)", href: `/channels/${cid}#baglantilar` },
  ];
  const missing = setup.filter((x) => !x.ok);
  const PLAT = [
    ["youtube", "YouTube", ch.toYoutube],
    ["tiktok", "TikTok", ch.toTiktok],
    ["instagram", "Instagram", ch.toInstagram],
  ] as const;

  return (
    <>
      <h1>Panel · {ch.name}</h1>
      {upcoming.some((u) => ["WRITING", "PRODUCING", "UPLOADING"].includes(u.status)) && <meta httpEquiv="refresh" content="15" />}
      {missing.length > 0 && (
        <div className="card">
          <b>Kurulum: {setup.length - missing.length}/{setup.length} tamam</b>
          <ul className="steps">
            {setup.map((x) => (
              <li key={x.label} style={{ listStyle: "none", marginLeft: -16 }}>
                {x.ok ? "✅" : "⬜"} {x.ok ? x.label : <Link href={x.href}>{x.label}</Link>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card row">
        {PLAT.map(([k, label, on]) => {
          const c = conns.find((x) => x.platform === k);
          return (
            <span key={k} className={`pill ${c && on ? "on" : ""}`} title={on ? "" : "Bu kanalda kapalı"}>
              {label}: {c ? c.accountName : "bağlı değil"}{!on && " (kapalı)"}
            </span>
          );
        })}
        <Link href={`/channels/${cid}#baglantilar`} style={{ marginLeft: "auto" }}>Hesapları yönet</Link>
      </div>

      <form action={quickVideo} className="card">
        <h2 style={{ marginTop: 0 }}>{s.contentFormat === "story" ? "Yeni bölüm üret" : s.contentFormat === "promo" ? "Yeni tanıtım videosu üret" : "Yeni video üret"}</h2>
        <div className="row">
          <input
            name="topic"
            placeholder={
              s.contentFormat === "story"
                ? "Bu bölüm için not (isteğe bağlı)"
                : s.contentFormat === "promo"
                  ? "Açı (isteğe bağlı, ör. akşam kaçan çağrılar); boşsa Claude seçer"
                  : "Konu (isteğe bağlı, boşsa Claude nişten seçer)"
            }
            style={{ flex: 1, minWidth: 220 }}
          />
          <select name="mode" defaultValue="review" style={{ width: "auto" }}>
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
          {s.contentFormat === "promo" ? "Ürün" : "Niş"}: <b>{(s.contentFormat === "promo" ? ch.productName : s.niche) || "— (kanal ayarlarından girin)"}</b> · Günde {s.videosPerDay} video · Saatler {s.publishTimes} · Ses: {s.ttsProvider} · Görsel: {s.imageProvider} · Otomatik: {s.autoProduce ? "açık" : "kapalı"}
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

      {account && (
        <>
          <h2>Performans (son 30 gün)</h2>
          <div className="card">
            <div className="grid">
              <div className="stat"><b>{fmt(agg._sum.views)}</b><span>izlenme</span></div>
              <div className="stat"><b>{fmt(agg._avg.views)}</b><span>video başına ortalama</span></div>
              <div className="stat"><b>{fmt(agg._sum.likes)}</b><span>beğeni</span></div>
              <div className="stat"><b>{fmt(agg._sum.comments)}</b><span>yorum</span></div>
              <div className="stat"><b>{agg._count}</b><span>yayınlanan video</span></div>
            </div>
            {top.length > 0 && (
              <table style={{ marginTop: 12 }}>
                <tbody>
                  {top.map((it, i) => (
                    <tr key={it.id}>
                      <td className="muted">{i + 1}.</td>
                      <td><Link href={`/items/${it.id}`}>{it.title}</Link></td>
                      <td style={{ whiteSpace: "nowrap" }}>👁 {fmt(it.views)} · 👍 {fmt(it.likes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form action={refreshStatsNow} className="row" style={{ marginTop: 10 }}>
              <span className="muted">İstatistikler saatte bir güncellenir; Claude yeni konu seçerken en iyi videolardan öğrenir.</span>
              <button className="secondary" style={{ marginLeft: "auto" }}>Şimdi güncelle</button>
            </form>
          </div>
        </>
      )}

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
                  <td>
                    <Link href={`/items/${it.id}`}>{cleanTitle(it.title, it.status)}</Link>
                    {it.kind !== "standard" && <span className="pill" style={{ marginLeft: 6 }}>{it.kind === "clip" ? "klip" : "satış"}</span>}
                    {it.progress && <div className="muted">⏳ {it.progress}</div>}
                    {it.error && <div className="err">{friendlyError(it.error)}</div>}
                  </td>
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
                    <td><Link href={`/items/${it.id}`}>{it.title}</Link></td>
                    <td style={{ whiteSpace: "nowrap" }}>{it.views != null ? `👁 ${fmt(it.views)}` : ""}</td>
                    <td>{it.youtubeVideoId && <a href={`https://youtube.com/shorts/${it.youtubeVideoId}`} target="_blank">YouTube&apos;da aç</a>}</td>
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
            {formatLocal(l.createdAt, s.timezone)} {l.itemId ? <Link href={`/items/${l.itemId}`}>[video]</Link> : ""} {l.level === "error" ? friendlyError(l.message) : l.message}
          </div>
        ))}
      </div>
    </>
  );
}
