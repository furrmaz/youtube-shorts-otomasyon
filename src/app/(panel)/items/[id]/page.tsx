import Link from "next/link";
import path from "node:path";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatLocal } from "@/lib/time";
import type { Scene } from "@/lib/video";
import { continueStory, produceNow, rewriteEpisode, redrawScene, regenerateMedia, rerenderVideo, setStatus, uploadNow } from "@/app/actions";
import { STATUS_TR, cleanTitle, friendlyError } from "@/app/status";
import { exists } from "@/lib/paths";
import { channelCorpus, compare } from "@/lib/originality";

export const dynamic = "force-dynamic";

export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const { id } = await params;
  const { msg } = await searchParams;
  const it = await prisma.contentItem.findUnique({ where: { id }, include: { logs: { orderBy: { id: "desc" }, take: 30 } } });
  if (!it) notFound();
  const s = await getSettings();
  const ch = it.channelId ? await prisma.channel.findUnique({ where: { id: it.channelId }, include: { connections: true } }) : null;
  const targets = ch
    ? ([
        ["youtube", "YouTube", ch.toYoutube],
        ["tiktok", "TikTok", ch.toTiktok],
        ["instagram", "Instagram", ch.toInstagram],
      ] as const).filter(([k, , on]) => on && ch.connections.some((c) => c.platform === k))
    : [];
  const plog: Record<string, { ok?: string; error?: string; at?: string }> = it.platformLog ? JSON.parse(it.platformLog) : {};
  const back = it.kind === "clip" ? ["/clips", "Demo klipleri"] : it.kind === "sales" ? ["/sales", "Satış videoları"] : it.episodeNumber != null ? ["/calendar", "Bölümler"] : ["/calendar", "Takvim"];
  const parsed: unknown = it.scenes ? JSON.parse(it.scenes) : [];
  // Demo kliplerinde "scenes" sahne listesi değil, kesim planıdır
  const scenes: Scene[] = Array.isArray(parsed) ? parsed : [];
  // Dosyalar silinmiş/taşınmış olabilir: sayfada kırık resim yerine açık uyarı göster
  const videoOk = !!it.videoPath && (await exists(it.videoPath));
  const imgOk = await Promise.all(scenes.map((sc) => (sc.image ? exists(sc.image) : Promise.resolve(false))));
  const needsRewrite = it.episodeNumber != null && it.status === "FAILED" && !it.script.trim();
  const isLatestEpisode =
    it.episodeNumber != null &&
    !!it.choiceA &&
    !!it.script.trim() &&
    !(await prisma.contentItem.findFirst({ where: { channelId: it.channelId, episodeNumber: { gt: it.episodeNumber } } }));
  const nextEp = it.episodeNumber != null
    ? await prisma.contentItem.findFirst({ where: { channelId: it.channelId, episodeNumber: it.episodeNumber + 1 } })
    : null;
  // Özgünlük: kanaldaki en benzer video (1 = tekrar sınırı)
  const closest = it.script.trim()
    ? (await channelCorpus(it.channelId))
        .filter((o) => o.id !== it.id)
        .map((o) => compare(it, o))
        .reduce<ReturnType<typeof compare>>((m, r) => (r && (!m || r.score > m.score) ? r : m), null)
    : null;
  const v = it.updatedAt.getTime();
  const busy = ["WRITING", "PRODUCING", "UPLOADING"].includes(it.status);

  return (
    <>
      <p><Link href={back[0]}>← {back[1]}</Link>{ch && <span className="muted"> · {ch.name}</span>}</p>
      <h1>{cleanTitle(it.title, it.status)}</h1>
      {msg && <div className="card err">{msg}</div>}
      <div className="card row">
        <span className={`badge ${it.status}`}>{STATUS_TR[it.status]}</span>
        <span className="muted">Yayın: {formatLocal(it.publishAt, s.timezone)} · Deneme {it.attempts}</span>
        {it.youtubeVideoId && <a href={`https://youtube.com/shorts/${it.youtubeVideoId}`} target="_blank">YouTube&apos;da aç</a>}
        {busy && <span className="muted">⏳ {it.progress ?? "işlem sürüyor"}, sayfa kendini yeniliyor</span>}
        {it.views != null && (
          <span className="muted">👁 {it.views.toLocaleString("tr-TR")} izlenme · 👍 {it.likes ?? 0} · 💬 {it.comments ?? 0}</span>
        )}
        {busy && <meta httpEquiv="refresh" content="8" />}
        {it.status === "READY" && !it.autoUpload && <span className="muted">Otomatik yüklenmeyecek, kontrol edip yükleyin</span>}
        {closest && (
          <span className={closest.score >= 1 ? "err" : "muted"} title="YouTube tekrarlayan içerik politikası için kanaldaki en benzer videoyla karşılaştırma">
            Özgünlük: {closest.score >= 1 ? "⚠ " : closest.score >= 0.7 ? "dikkat, " : "iyi, "}en benzer{" "}
            {closest.id ? <Link href={`/items/${closest.id}`}>{cleanTitle(closest.title, "")}</Link> : closest.title} ({closest.field} %{Math.round(closest.raw * 100)} örtüşüyor)
          </span>
        )}
      </div>
      {it.error && <div className="card err">{friendlyError(it.error)}</div>}
      {it.videoPath && !videoOk && !busy && (
        <div className="card err">Video dosyası bulunamadı (silinmiş veya taşınmış). &quot;Baştan üret&quot; ile yeniden oluşturabilirsin.</div>
      )}
      {(Object.keys(plog).length > 0 || it.tiktokId || it.instagramId) && (
        <div className="card row">
          <b>Platformlar:</b>
          {it.youtubeVideoId && <a href={`https://youtube.com/shorts/${it.youtubeVideoId}`} target="_blank">YouTube ✓</a>}
          {plog.youtube?.error && <span className="err">YouTube: {plog.youtube.error}</span>}
          {it.tiktokId && <span className="pill on">TikTok {it.tiktokId.startsWith("taslak:") ? "✓ taslak olarak gönderildi (TikTok uygulamasından paylaşın)" : "✓"}</span>}
          {plog.tiktok?.error && <span className="err">TikTok: {plog.tiktok.error}</span>}
          {it.instagramId && <span className="pill on">Instagram ✓</span>}
          {plog.instagram?.error && <span className="err">Instagram: {plog.instagram.error}</span>}
        </div>
      )}
      {it.shareText && (
        <div className="card">
          <label style={{ marginTop: 0 }}>Müşteriye gönderilecek mesaj ({it.sector})</label>
          <textarea className="sharebox" readOnly defaultValue={it.shareText} />
        </div>
      )}

      <div className="card row">
        {it.status === "DRAFT" && (
          <form action={setStatus}>
            <input type="hidden" name="id" value={it.id} />
            <input type="hidden" name="status" value="APPROVED" />
            <button className="secondary">Onayla</button>
          </form>
        )}
        {needsRewrite && (
          <form action={rewriteEpisode}>
            <input type="hidden" name="id" value={it.id} />
            <button>Bölümü yeniden yaz{it.chosen ? " (aynı seçimle)" : ""}</button>
          </form>
        )}
        {["DRAFT", "APPROVED", "FAILED"].includes(it.status) && !needsRewrite && (
          <form action={produceNow}>
            <input type="hidden" name="id" value={it.id} />
            <button>Şimdi üret</button>
          </form>
        )}
        {["READY", "FAILED"].includes(it.status) && !needsRewrite && (
          <form action={regenerateMedia}>
            <input type="hidden" name="id" value={it.id} />
            <button className="secondary">Baştan üret (yeni ses + görseller)</button>
          </form>
        )}
        {["READY", "FAILED"].includes(it.status) && it.scenes && (
          <form action={rerenderVideo}>
            <input type="hidden" name="id" value={it.id} />
            <button className="secondary" title="Ses ve görseller korunur; müzik, efekt ve altyazı ayarları yeniden uygulanır">Sadece montajı yenile</button>
          </form>
        )}
        {videoOk && (
          <a className="btn secondary" href={`/api/media/${it.id}/short.mp4?download=1`}>MP4 indir (TikTok / Reels)</a>
        )}
        {it.status === "READY" && targets.length > 0 && (
          <form action={uploadNow}>
            <input type="hidden" name="id" value={it.id} />
            <button>Şimdi yayınla ({targets.map((t) => t[1]).join(", ")})</button>
          </form>
        )}
        {it.status === "READY" && targets.length === 0 && ch && (
          <Link className="btn secondary" href={`/channels/${ch.id}#baglantilar`}>Yayınlamak için hesap bağla</Link>
        )}
      </div>

      {videoOk && (
        <div className="card">
          <video controls preload="metadata" src={`/api/media/${it.id}/short.mp4?v=${v}`} />
        </div>
      )}

      {scenes.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Sahneler</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Beğenmediğiniz sahnenin tarifini düzenleyip yeniden çizdirebilirsiniz; ses ve diğer sahneler korunur, video yeniden birleştirilir.
          </p>
          <div className="scenes">
            {scenes.map((sc, i) => (
              <div key={i} className="scene">
                {sc.image && imgOk[i] ? (
                  <img src={`/api/media/${it.id}/${path.basename(sc.image)}?v=${v}`} alt={sc.text} />
                ) : (
                  <div className="scene-empty">⏳</div>
                )}
                <div className="muted">{i + 1}. sahne · {sc.start.toFixed(1)}–{sc.end.toFixed(1)} sn</div>
                <div className="scene-text">{sc.text}</div>
                {["READY", "FAILED"].includes(it.status) && (
                  <details>
                    <summary className="muted">Yeniden çiz</summary>
                    <form action={redrawScene}>
                      <input type="hidden" name="id" value={it.id} />
                      <input type="hidden" name="idx" value={i} />
                      <textarea name="prompt" defaultValue={sc.imagePrompt} style={{ minHeight: 120, fontSize: 12 }} />
                      <button className="secondary" style={{ marginTop: 6 }}>Bu sahneyi yeniden çiz</button>
                    </form>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {it.choiceA && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Bölüm {it.episodeNumber} seçimleri</h2>
          {it.chosen && <p className="muted">Bu bölüm önceki seçimle başladı: {it.chosen}</p>}
          <p><b>A:</b> {it.choiceA} {it.votesA != null && <span className="muted">({it.votesA} oy)</span>}</p>
          <p><b>B:</b> {it.choiceB} {it.votesB != null && <span className="muted">({it.votesB} oy)</span>}</p>
          {it.summary && <p className="muted">Özet: {it.summary}</p>}
          {nextEp && (
            <p>Devamı: <Link href={`/items/${nextEp.id}`}>{cleanTitle(nextEp.title, nextEp.status)}</Link></p>
          )}
        </div>
      )}

      {isLatestEpisode && !busy && (
        <form action={continueStory} className="card" id="devam">
          <input type="hidden" name="id" value={it.id} />
          <h2 style={{ marginTop: 0 }}>Bölüme devam et</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Yorum oylarını beklemeden devamı sen seç: Bölüm {it.episodeNumber! + 1} bu yönde yazılıp hemen üretilir.
            Otomatik modda oylar sayılır; buradan seçersen senin seçimin geçerli olur.
          </p>
          <div className="checks" style={{ gridTemplateColumns: "1fr" }}>
            <label><input type="radio" name="choice" value="A" defaultChecked /> <b>A:</b> {it.choiceA}{it.votesA != null && <span className="muted"> ({it.votesA} oy)</span>}</label>
            <label><input type="radio" name="choice" value="B" /> <b>B:</b> {it.choiceB}{it.votesB != null && <span className="muted"> ({it.votesB} oy)</span>}</label>
            <label><input type="radio" name="choice" value="custom" /> Kendi devamımı yazacağım:</label>
          </div>
          <textarea name="text" placeholder="ör. Camı açmıyorsun ama telsizden adamın sesini duyuyorsun…" style={{ minHeight: 60, marginTop: 6 }} />
          <details style={{ marginTop: 8 }}>
            <summary className="muted">Yeni bölümün sonundaki seçenekleri de ben yazayım (isteğe bağlı)</summary>
            <div className="two">
              <div>
                <label>Yeni A seçeneği</label>
                <input name="nextA" placeholder="ör. Telsizi kapat" />
              </div>
              <div>
                <label>Yeni B seçeneği</label>
                <input name="nextB" placeholder="ör. Sesi takip et" />
              </div>
            </div>
            <label>Bölüm için ek not</label>
            <input name="note" placeholder="ör. sonunda yeni bir karakter ortaya çıksın" />
          </details>
          <div className="row" style={{ marginTop: 12 }}>
            <select name="mode" defaultValue="review" style={{ width: "auto" }}>
              <option value="review">Üret, önce ben bakayım</option>
              <option value="publish">Üret ve hemen yayınla</option>
            </select>
            <button>Devam bölümünü üret</button>
          </div>
        </form>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Metin</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{it.script}</p>
        <p className="muted">{it.description}</p>
      </div>

      <h2>Kayıtlar</h2>
      <div className="card logs">
        {it.logs.map((l) => (
          <div key={l.id} className={l.level}>{formatLocal(l.createdAt, s.timezone)} {l.message}</div>
        ))}
      </div>
    </>
  );
}
