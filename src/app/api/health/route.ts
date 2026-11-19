// Sunucu izleme için: panel ayakta mı, veritabanı açılıyor mu, zamanlayıcı son 5 dakikada çalıştı mı?
// Docker healthcheck ve uptime servisleri (ör. UptimeRobot) bu adresi kontrol eder. Gizli bilgi döndürmez.
import { prisma } from "@/lib/db";
import { lastBeatAgo } from "@/lib/heartbeat";

export const dynamic = "force-dynamic";

export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  const workerAgo = await lastBeatAgo();
  const worker = workerAgo != null && workerAgo < 300;
  const ok = db && worker;
  return Response.json({ ok, db, worker, workerSecondsAgo: workerAgo }, { status: ok ? 200 : 503 });
}
