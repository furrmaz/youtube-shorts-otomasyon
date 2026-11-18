import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { analyzeReference, styleDir } from "@/lib/style";

const EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

/** Örnek video yükleme: POST /api/style/upload?channel=..&name=ornek.mp4&note=.. (gövde = dosya) */
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Oturum açın" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const channelId = q.get("channel") ?? "";
  const ch = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!ch) return NextResponse.json({ error: "Kanal bulunamadı" }, { status: 400 });
  const ext = path.extname(q.get("name") ?? "").toLowerCase() || ".mp4";
  if (!EXT.has(ext)) return NextResponse.json({ error: `Desteklenmeyen dosya türü: ${ext}` }, { status: 400 });
  if (!req.body) return NextResponse.json({ error: "Dosya yok" }, { status: 400 });
  const dir = styleDir(channelId);
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(dir, { recursive: true });
  const out = path.join(dir, `ornek${ext}`);
  try {
    await pipeline(Readable.fromWeb(req.body as unknown as NodeWebStream), fs.createWriteStream(out));
  } catch (e) {
    return NextResponse.json({ error: `Yükleme yarıda kaldı: ${(e as Error).message}` }, { status: 500 });
  }
  await prisma.channel.update({ where: { id: channelId }, data: { styleRefPath: out, styleProfile: "", styleStatus: "analiz" } });
  void analyzeReference(channelId, (q.get("note") ?? "").slice(0, 500));
  return NextResponse.json({ ok: true });
}
