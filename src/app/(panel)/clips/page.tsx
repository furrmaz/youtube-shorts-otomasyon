import { AutoRefresh } from "@/app/components/AutoRefresh";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { currentChannel } from "@/lib/current-channel";
import { formatLocal } from "@/lib/time";
import { STATUS_TR } from "@/app/status";
import { ClipUpload } from "@/app/components/ClipUpload";

export const dynamic = "force-dynamic";

export default async function ClipsPage() {
  const s = await getSettings();
  const ch = await currentChannel();
  const clips = await prisma.contentItem.findMany({ where: { channelId: ch.id, kind: "clip" }, orderBy: { createdAt: "desc" }, take: 50 });
  const busy = clips.some((c) => ["WRITING", "PRODUCING", "UPLOADING"].includes(c.status));
  return (
    <>
      <h1>Demo klipleri · {ch.name}</h1>
      {busy && <AutoRefresh seconds={10} />}
      <ClipUpload channelId={ch.id} />
      <div className="card">
        {clips.length === 0 ? (
          <span className="muted">Henüz klip yok.</span>
        ) : (
          <table>
            <tbody>
              {clips.map((it) => (
                <tr key={it.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatLocal(it.createdAt, s.timezone)}</td>
                  <td>
                    <Link href={`/items/${it.id}`}>{it.title}</Link>
                    {it.progress && <div className="muted">⏳ {it.progress}</div>}
                    {it.error && <div className="err">{it.error}</div>}
                  </td>
                  <td><span className={`badge ${it.status}`}>{STATUS_TR[it.status]}</span></td>
                  <td>{it.videoPath && <a href={`/api/media/${it.id}/short.mp4?download=1`}>MP4</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
