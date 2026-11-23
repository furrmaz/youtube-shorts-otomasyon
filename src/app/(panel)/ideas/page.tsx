import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentChannel } from "@/lib/current-channel";
import { getSettings } from "@/lib/settings";
import { formatLocal } from "@/lib/time";
import { addIdea, quickVideo, scanIdeasNow, setIdeaStatus } from "@/app/actions";

export const dynamic = "force-dynamic";

const TABS = [
  ["new", "Yeni"],
  ["used", "Kullanıldı"],
  ["hidden", "Gizlenen"],
] as const;

export default async function IdeasPage({ searchParams }: { searchParams: Promise<{ t?: string; ok?: string; msg?: string }> }) {
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.t) ? sp.t! : "new";
  const ch = await currentChannel();
  const s = await getSettings();
  const yt = await prisma.connection.findUnique({ where: { channelId_platform: { channelId: ch.id, platform: "youtube" } } });
  const ideas = await prisma.topicIdea.findMany({
    where: { channelId: ch.id, status: tab },
    orderBy: [{ count: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  const counts = await prisma.topicIdea.groupBy({ by: ["status"], where: { channelId: ch.id }, _count: true });
  const n = (k: string) => counts.find((c) => c.status === k)?._count ?? 0;

  return (
    <>
      <h1>İzleyici istekleri · {ch.name}</h1>
      {sp.ok && <div className="card">{sp.ok} ✓</div>}
      {sp.msg && <div className="card err">{sp.msg}</div>}
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Yorumlarda &quot;şunu da anlatın&quot; denen konular burada toplanır ve kaç kez istendiği sayılır. Panel 12 saatte bir son 30 günün
          videolarındaki yeni yorumları okur. <Link href="/calendar">Takvim</Link> oluşturulurken en çok istenenler önce işlenir.
        </p>
        <div className="row">
          {yt ? (
            <form action={scanIdeasNow}>
              <button>Yorumları şimdi tara</button>
            </form>
          ) : (
            <Link className="btn secondary" href={`/channels/${ch.id}#baglantilar`}>Yorumları okumak için YouTube&apos;u bağla</Link>
          )}
          <span className="muted">
            Son tarama: {ch.ideasScanAt ? formatLocal(ch.ideasScanAt, s.timezone) : "henüz yok"}
            {!ch.endLine && " · İpucu: kanal ayarlarına \"merak ettiğini yoruma yaz\" gibi bir kapanış cümlesi eklersen istek sayısı artar."}
          </span>
        </div>
      </div>

      <form action={addIdea} className="card row">
        <input name="topics" placeholder="Elle konu ekle (virgülle birden fazla), ör. Alex de Souza, Hagi" style={{ flex: 1, minWidth: 240 }} />
        <button className="secondary">Ekle</button>
      </form>

      <div className="row" style={{ marginBottom: 12 }}>
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/ideas?t=${k}`} className={k === tab ? "pill on" : "pill"}>
            {label} ({n(k)})
          </Link>
        ))}
      </div>

      {ideas.length === 0 && <div className="card muted">Bu listede konu yok.</div>}
      {ideas.map((i) => (
        <div key={i.id} className="card row">
          <div style={{ flex: 1, minWidth: 220 }}>
            <b>{i.topic}</b>{" "}
            <span className="muted">
              · {i.source === "elle" ? "elle eklendi" : `${i.count} yorumda istendi`}
            </span>
            {i.example && <div className="muted" style={{ fontSize: 13 }}>&ldquo;{i.example}&rdquo;</div>}
            {i.itemId && <Link href={`/items/${i.itemId}`} className="muted" style={{ fontSize: 13 }}>Bu konudaki video →</Link>}
          </div>
          {i.status !== "used" && ch.contentFormat !== "story" && (
            <form action={quickVideo} className="row">
              <input type="hidden" name="topic" value={i.topic} />
              <input type="hidden" name="ideaId" value={i.id} />
              <select name="mode" defaultValue="hook" style={{ width: "auto" }}>
                <option value="hook">Metni yaz, kancayı ben seçeyim</option>
                <option value="review">Üret, önce ben bakayım</option>
                <option value="publish">Üret ve hemen yayınla</option>
              </select>
              <button>Video yap</button>
            </form>
          )}
          <form action={setIdeaStatus}>
            <input type="hidden" name="id" value={i.id} />
            <input type="hidden" name="status" value={i.status === "new" ? "hidden" : "new"} />
            <button className="secondary">{i.status === "new" ? "Gizle" : "Yeniden aç"}</button>
          </form>
        </div>
      ))}
    </>
  );
}
