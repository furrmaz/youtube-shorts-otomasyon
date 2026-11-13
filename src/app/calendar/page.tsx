import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { calendarJob } from "@/lib/pipeline";
import { formatLocal, toLocalInput } from "@/lib/time";
import { approveAll, deleteItem, saveItem, setStatus, startCalendar } from "../actions";
import { STATUS_TR } from "../status";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f } = await searchParams;
  const s = await getSettings();
  const job = calendarJob();
  const items = await prisma.contentItem.findMany({
    where: f ? { status: f } : {},
    orderBy: { publishAt: "asc" },
  });
  const drafts = await prisma.contentItem.count({ where: { status: "DRAFT" } });

  return (
    <>
      <h1>İçerik takvimi</h1>
      <div className="card">
        <form action={startCalendar} className="row">
          <span>Claude nişi araştırsın ve</span>
          <input name="days" type="number" defaultValue={30} min={1} max={60} style={{ width: 80 }} />
          <span>günlük plan yazsın</span>
          <button disabled={job?.running || !s.niche}>Takvim oluştur</button>
        </form>
        {!s.niche && <p className="err">Önce <Link href="/settings">Ayarlar</Link>&apos;dan niş girin.</p>}
        {job && (
          <p className={job.error ? "err" : "muted"}>
            {job.running ? "⏳ " : ""}
            {job.message}
            {job.error ? `: ${job.error}` : ""}
            {job.running && " (birkaç dakika sürebilir, sayfayı yenileyin)"}
          </p>
        )}
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted">Filtre:</span>
        <Link href="/calendar">Tümü</Link>
        {Object.entries(STATUS_TR).map(([k, v]) => (
          <Link key={k} href={`/calendar?f=${k}`}>{v}</Link>
        ))}
        {drafts > 0 && (
          <form action={approveAll} style={{ marginLeft: "auto" }}>
            <button className="secondary">Tüm taslakları onayla ({drafts})</button>
          </form>
        )}
      </div>

      {items.length === 0 && <div className="card muted">Henüz içerik yok.</div>}
      {items.map((it) => {
        const editable = !["PRODUCING", "UPLOADING", "UPLOADED"].includes(it.status);
        return (
          <details key={it.id} className="card">
            <summary className="row">
              <span className={`badge ${it.status}`}>{STATUS_TR[it.status] ?? it.status}</span>
              <b>{it.title}</b>
              <span className="muted">· Gün {it.dayIndex} · {formatLocal(it.publishAt, s.timezone)}</span>
            </summary>
            <form action={saveItem} style={{ marginTop: 10 }}>
              <input type="hidden" name="id" value={it.id} />
              <div className="two">
                <div>
                  <label>Konu</label>
                  <input name="topic" defaultValue={it.topic} disabled={!editable} />
                </div>
                <div>
                  <label>Yayın zamanı ({s.timezone})</label>
                  <input type="datetime-local" name="publishAt" defaultValue={toLocalInput(it.publishAt, s.timezone)} disabled={!editable} />
                </div>
              </div>
              <label>Kanca</label>
              <input name="hook" defaultValue={it.hook} disabled={!editable} />
              <label>Metin ({it.script.split(/\s+/).length} kelime)</label>
              <textarea name="script" defaultValue={it.script} disabled={!editable} />
              <label>Başlık</label>
              <input name="title" defaultValue={it.title} disabled={!editable} />
              <label>Açıklama</label>
              <textarea name="description" defaultValue={it.description} style={{ minHeight: 70 }} disabled={!editable} />
              <label>Etiketler (virgülle)</label>
              <input name="tags" defaultValue={(JSON.parse(it.tags) as string[]).join(", ")} disabled={!editable} />
              <div className="row" style={{ marginTop: 12 }}>
                {editable && <button className="secondary">Kaydet</button>}
                <Link className="btn secondary" href={`/items/${it.id}`}>Detay</Link>
              </div>
            </form>
            <div className="row" style={{ marginTop: 8 }}>
              {it.status === "DRAFT" && (
                <form action={setStatus}>
                  <input type="hidden" name="id" value={it.id} />
                  <input type="hidden" name="status" value="APPROVED" />
                  <button>Onayla</button>
                </form>
              )}
              {it.status === "APPROVED" && (
                <form action={setStatus}>
                  <input type="hidden" name="id" value={it.id} />
                  <input type="hidden" name="status" value="DRAFT" />
                  <button className="secondary">Onayı geri al</button>
                </form>
              )}
              {editable && (
                <form action={deleteItem}>
                  <input type="hidden" name="id" value={it.id} />
                  <button className="danger">Sil</button>
                </form>
              )}
            </div>
          </details>
        );
      })}
    </>
  );
}
