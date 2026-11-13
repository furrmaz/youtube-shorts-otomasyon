import Link from "next/link";
import path from "node:path";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatLocal } from "@/lib/time";
import type { Scene } from "@/lib/video";
import { produceNow, regenerateMedia, setStatus, uploadNow } from "../../actions";
import { STATUS_TR } from "../../status";

export const dynamic = "force-dynamic";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const it = await prisma.contentItem.findUnique({ where: { id }, include: { logs: { orderBy: { id: "desc" }, take: 30 } } });
  if (!it) notFound();
  const s = await getSettings();
  const yt = await prisma.youtubeAccount.findUnique({ where: { id: 1 } });
  const scenes: Scene[] = it.scenes ? JSON.parse(it.scenes) : [];
  const v = it.updatedAt.getTime();
  const busy = it.status === "PRODUCING" || it.status === "UPLOADING";

  return (
    <>
      <p><Link href="/calendar">← Takvim</Link></p>
      <h1>{it.title}</h1>
      <div className="card row">
        <span className={`badge ${it.status}`}>{STATUS_TR[it.status]}</span>
        <span className="muted">Yayın: {formatLocal(it.publishAt, s.timezone)} · Deneme {it.attempts}</span>
        {it.youtubeVideoId && <a href={`https://youtube.com/shorts/${it.youtubeVideoId}`} target="_blank">YouTube&apos;da aç</a>}
        {busy && <span className="muted">⏳ işlem sürüyor, sayfayı yenileyin</span>}
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
          <div className="thumbs">
            {scenes.map((sc, i) =>
              sc.image ? (
                <img key={i} src={`/api/media/${it.id}/${path.basename(sc.image)}?v=${v}`} alt={sc.text} title={sc.imagePrompt} />
              ) : null,
            )}
          </div>
          <table style={{ marginTop: 10 }}>
            <tbody>
              {scenes.map((sc, i) => (
                <tr key={i}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{sc.start.toFixed(1)}–{sc.end.toFixed(1)} sn</td>
                  <td>{sc.text}<div className="muted">{sc.imagePrompt}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
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
