import Link from "next/link";
import path from "node:path";
import { currentChannel } from "@/lib/current-channel";
import { parseStyle } from "@/lib/channels";
import { exists } from "@/lib/paths";
import { styleDir } from "@/lib/style";
import { applyStyle, disableStyle, reanalyzeStyle, removeStyle } from "@/app/actions";
import { StyleUpload } from "@/app/components/StyleUpload";

export const dynamic = "force-dynamic";

const CAP: Record<string, string> = { karaoke: "büyük, kelime kelime vurgulu", minimal: "sade, altta", off: "altyazı yok" };

export default async function StylePage({ searchParams }: { searchParams: Promise<{ applied?: string }> }) {
  const { applied } = await searchParams;
  const ch = await currentChannel();
  const p = parseStyle(ch);
  const busy = ch.styleStatus === "analiz";
  const err = ch.styleStatus.startsWith("hata:") ? ch.styleStatus.slice(5).trim() : "";
  const refFile = ch.styleRefPath ? path.basename(ch.styleRefPath) : "";
  const thumb = (await exists(path.join(styleDir(ch.id), "thumb.jpg"))) ? `/api/media/ref${ch.id}/thumb.jpg` : null;

  return (
    <>
      <h1>Örnek video · {ch.name}</h1>
      {busy && <meta httpEquiv="refresh" content="8" />}
      {applied && <div className="card">Tarz bu kanala uygulandı ✓ Bundan sonra üretilen videolar bu örneğe göre yazılır, çizilir ve kurgulanır.</div>}
      <p className="muted">
        Beğendiğin bir Shorts/Reels/TikTok videosunu yükle. Claude videoyu kare kare izler, konuşmasını dinler, kesme sayısını ve konuşma hızını
        ölçer; kancasını, akışını, görsel dilini, altyazısını, sesini ve süresini çıkarır. Uygulayınca bu kanalın yeni videoları <b>konusu değil,
        biçimi</b> bu örneğe benzer şekilde üretilir. YouTube/TikTok&apos;taki bir videoyu önce bilgisayarına indirip buraya yükleyebilirsin.
      </p>

      <div className="card">
        {ch.styleRefPath && (
          <div className="row" style={{ alignItems: "flex-start", marginBottom: 12 }}>
            <video controls preload="metadata" src={`/api/media/ref${ch.id}/${refFile}`} poster={thumb ?? undefined} style={{ maxHeight: 360 }} />
            <div style={{ flex: 1, minWidth: 240 }}>
              {busy && <p>⏳ Claude örneği inceliyor (1-2 dakika), sayfa kendini yeniliyor…</p>}
              {err && (
                <p className="err">
                  Çözümlenemedi: {err}
                  <br />
                  Claude anahtarı girili mi? <Link href="/settings#anahtarlar">Ayarlar</Link>
                </p>
              )}
              {p && !busy && (
                <p>
                  {ch.styleOn ? <span className="pill on">Bu kanalda açık</span> : <span className="pill">Henüz uygulanmadı</span>}
                </p>
              )}
              <div className="row">
                {p && !ch.styleOn && !busy && (
                  <form action={applyStyle}>
                    <input type="hidden" name="id" value={ch.id} />
                    <button>Bu tarzı kanala uygula</button>
                  </form>
                )}
                {ch.styleOn && (
                  <form action={disableStyle}>
                    <input type="hidden" name="id" value={ch.id} />
                    <button className="secondary">Tarzı kapat</button>
                  </form>
                )}
                {!busy && (
                  <form action={reanalyzeStyle}>
                    <input type="hidden" name="id" value={ch.id} />
                    <button className="secondary">Yeniden çözümle</button>
                  </form>
                )}
                <form action={removeStyle}>
                  <input type="hidden" name="id" value={ch.id} />
                  <button className="danger">Örneği sil</button>
                </form>
              </div>
            </div>
          </div>
        )}
        <StyleUpload channelId={ch.id} hasRef={!!ch.styleRefPath} />
      </div>

      {p && (
        <>
          <h2>Claude&apos;un çıkardığı tarif</h2>
          <div className="card">
            <p style={{ marginTop: 0 }}>{p.summary}</p>
            <div className="grid">
              <div className="stat"><b>{Math.round(p.seconds)} sn</b><span>süre</span></div>
              <div className="stat"><b>{p.avgSceneSeconds.toFixed(1)} sn</b><span>ortalama sahne</span></div>
              <div className="stat"><b>{p.wordsPerMinute ? Math.round(p.wordsPerMinute) : "—"}</b><span>kelime / dakika</span></div>
              <div className="stat"><b>{p.motion === "slow" ? "yavaş" : "hızlı"}</b><span>kamera hareketi</span></div>
            </div>
            <table style={{ marginTop: 12 }}>
              <tbody>
                <tr><td className="muted">Kanca</td><td>{p.hookPattern}</td></tr>
                <tr><td className="muted">Akış</td><td><ol className="steps" style={{ margin: 0 }}>{p.structure.map((x, i) => <li key={i}>{x}</li>)}</ol></td></tr>
                <tr><td className="muted">Yazım</td><td>{p.scriptGuide}</td></tr>
                <tr><td className="muted">Bitiş</td><td>{p.ending}</td></tr>
                <tr><td className="muted">Görsel stil</td><td>{p.visualStyle}
                  <div className="row" style={{ marginTop: 6 }}>{p.palette.map((c) => <span key={c} title={c} style={{ width: 22, height: 22, borderRadius: 4, background: c, display: "inline-block", border: "1px solid #333" }} />)}</div>
                </td></tr>
                <tr><td className="muted">Sahne kurgusu</td><td>{p.sceneGuide}</td></tr>
                <tr><td className="muted">Altyazı</td><td>{CAP[p.captionStyle]}. {p.captionNotes}</td></tr>
                <tr><td className="muted">Ses</td><td>{p.voiceNotes}</td></tr>
                <tr><td className="muted">Müzik</td><td>{p.musicPrompt}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card muted">
            <b style={{ color: "var(--text)" }}>Uygulayınca ne değişir?</b>
            <ul className="steps">
              <li>Metinler bu kanca, akış, yazım kuralları ve süreyle yazılır.</li>
              <li>Sahne sayısı örnekteki tempoya göre hesaplanır, sahneler örnekteki çekim diliyle çizilir; kamera hareketi ve geçişler de uyarlanır.</li>
              <li>Kanal ayarlarındaki görsel stil, altyazı türü, müzik tarifi ve ton bu tarife göre güncellenir (sonra elle değiştirebilirsin).</li>
              <li>Ses: ElevenLabs sesini sen seçersin. Yukarıdaki &quot;Ses&quot; notuna uyan bir sesi <Link href={`/channels/${ch.id}`}>kanal ayarlarından</Link> seç.</li>
            </ul>
          </div>
        </>
      )}
    </>
  );
}
