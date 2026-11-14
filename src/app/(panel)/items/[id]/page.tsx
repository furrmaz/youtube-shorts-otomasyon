import Link from "next/link";
import path from "node:path";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatLocal } from "@/lib/time";
import type { Scene } from "@/lib/video";
import { produceNow, redrawScene, regenerateMedia, rerenderVideo, setStatus, uploadNow } from "@/app/actions";
import { STATUS_TR } from "@/app/status";

export const dynamic = "force-dynamic";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const it = await prisma.contentItem.findUnique({ where: { id }, include: { logs: { orderBy: { id: "desc" }, take: 30 } } });
  if (!it) notFound();
  const s = await getSettings();
  const yt = await prisma.youtubeAccount.findUnique({ where: { id: 1 } });
  const scenes: Scene[] = it.scenes ? JSON.parse(it.scenes) : [];
  const v = it.updatedAt.getTime();
  const busy = ["WRITING", "PRODUCING", "UPLOADING"].includes(it.status);

  return (
    <>
      <p><Link href="/calendar">← Takvim</Link></p>
      <h1>{it.title}</h1>
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
      </div>
      {it.error && <div className="card err">{it.error}</div>}

      <div className="card row">
        {it.status === "DRAFT" && (
          <form action={setStatus}>
            <input type="hidden" name="id" value={it.id} />
            <input type="hidden" name="status" value="APPROVED" />
            <button className="secondary">Onayla</button>
          </form>
        )}
        {["DRAFT", "APPROVED", "FAILED"].includes(it.status) && (
          <form action={produceNow}>
            <input type="hidden" name="id" value={it.id} />
            <button>Şimdi üret</button>
          </form>
        )}
        {["READY", "FAILED"].includes(it.status) && (
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
        {it.videoPath && (
          <a className="btn secondary" href={`/api/media/${it.id}/short.mp4?download=1`}>MP4 indir (TikTok / Reels)</a>
        )}
        {it.status === "READY" && (
          <form action={uploadNow}>
            <input type="hidden" name="id" value={it.id} />
            <button disabled={!yt}>{yt ? "YouTube'a yükle" : "Önce kanal bağlayın"}</button>
          </form>
        )}
      </div>

      {it.videoPath && (
        <div className="card">
          <video controls src={`/api/media/${it.id}/short.mp4?v=${v}`} />
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
                {sc.image ? (
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
        </div>
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
