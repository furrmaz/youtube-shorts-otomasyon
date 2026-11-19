import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { listChannels } from "@/lib/channels";
import { formatLocal } from "@/lib/time";
import { STATUS_TR, cleanTitle } from "@/app/status";

export const dynamic = "force-dynamic";

const KINDS: Record<string, string> = { standard: "Takvim / yeni video", sales: "Satış videosu", clip: "Demo klibi" };
const PAGE = 24;

type Search = { kanal?: string; tur?: string; durum?: string; q?: string; sira?: string; sayfa?: string };

/** Üretilmiş tüm videolar: kanal, tür, durum ve aramayla filtrelenip panelde izlenebilir */
export default async function MediaPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const s = await getSettings();
  const channels = await listChannels();
  const page = Math.max(1, Number(sp.sayfa) || 1);

  const where: Prisma.ContentItemWhereInput = { videoPath: { not: null } };
  if (sp.kanal) where.channelId = sp.kanal;
  if (sp.tur && KINDS[sp.tur]) where.kind = sp.tur;
  if (sp.durum === "yuklendi") where.status = "UPLOADED";
  else if (sp.durum === "bekliyor") where.status = { in: ["READY", "UPLOADING", "FAILED"] };
  if (sp.q?.trim()) where.OR = [{ title: { contains: sp.q.trim() } }, { topic: { contains: sp.q.trim() } }];
  const orderBy: Prisma.ContentItemOrderByWithRelationInput =
    sp.sira === "izlenme" ? { views: { sort: "desc", nulls: "last" } } : sp.sira === "eski" ? { updatedAt: "asc" } : { updatedAt: "desc" };

  const [items, total] = await Promise.all([
    prisma.contentItem.findMany({ where, orderBy, skip: (page - 1) * PAGE, take: PAGE, include: { channel: true } }),
    prisma.contentItem.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...sp, sayfa: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `/media?${q}`;
  };

  return (
    <>
      <h1>Medya</h1>
      <form className="card mediafilter" method="get">
        <div>
          <label>Kanal</label>
          <select name="kanal" defaultValue={sp.kanal ?? ""}>
            <option value="">Tüm kanallar</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Tür</label>
          <select name="tur" defaultValue={sp.tur ?? ""}>
            <option value="">Hepsi</option>
            {Object.entries(KINDS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Durum</label>
          <select name="durum" defaultValue={sp.durum ?? ""}>
            <option value="">Hepsi</option>
            <option value="yuklendi">Yayına yüklendi</option>
            <option value="bekliyor">Henüz yüklenmedi</option>
          </select>
        </div>
        <div>
          <label>Sıralama</label>
          <select name="sira" defaultValue={sp.sira ?? ""}>
            <option value="">En yeni</option>
            <option value="eski">En eski</option>
            <option value="izlenme">En çok izlenen</option>
          </select>
        </div>
        <div style={{ flex: 2 }}>
          <label>Ara</label>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Başlık ya da konu" />
        </div>
        <div className="row" style={{ alignSelf: "flex-end" }}>
          <button type="submit">Filtrele</button>
          <Link className="btn secondary" href="/media">Temizle</Link>
        </div>
      </form>

      <div className="muted" style={{ marginBottom: 10 }}>{total} video</div>
      {items.length === 0 ? (
        <div className="card muted">Bu filtreye uyan video yok.</div>
      ) : (
        <div className="mediagrid">
          {items.map((it) => (
            <div key={it.id} className="mediacard" style={{ borderTopColor: it.channel?.primaryColor ?? "#2a3040" }}>
              <video controls preload="metadata" src={`/api/media/${it.id}/short.mp4?v=${it.updatedAt.getTime()}#t=0.5`} />
              <div className="mediainfo">
                <Link href={`/items/${it.id}`} className="mediatitle">{cleanTitle(it.title, it.status)}</Link>
                <div className="muted">
                  {it.channel?.name ?? "—"} · {formatLocal(it.updatedAt, s.timezone)}
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <span className={`badge ${it.status}`}>{STATUS_TR[it.status]}</span>
                  {it.views != null && <span className="pill">👁 {it.views.toLocaleString("tr-TR")}</span>}
                  {it.likes != null && <span className="pill">❤ {it.likes.toLocaleString("tr-TR")}</span>}
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <a href={`/api/media/${it.id}/short.mp4?download=1`}>MP4 indir</a>
                  {it.youtubeVideoId && (
                    <a href={`https://youtube.com/shorts/${it.youtubeVideoId}`} target="_blank" rel="noreferrer">YouTube</a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {pages > 1 && (
        <div className="row" style={{ marginTop: 16, justifyContent: "center" }}>
          {page > 1 && <Link className="btn secondary" href={link(page - 1)}>‹ Önceki</Link>}
          <span className="muted">Sayfa {page} / {pages}</span>
          {page < pages && <Link className="btn secondary" href={link(page + 1)}>Sonraki ›</Link>}
        </div>
      )}
    </>
  );
}
