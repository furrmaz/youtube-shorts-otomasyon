import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";
import { MEDIA_DIR } from "@/lib/paths";
import { createClip } from "@/lib/pipeline";
import { prisma } from "@/lib/db";

const EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);

/**
 * Demo videosu yükleme: dosya gövdesi doğrudan diske akıtılır (büyük dosyalar belleğe alınmaz).
 * POST /api/upload?channel=..&name=demo.mp4&narrate=1&seconds=35&publish=0&note=..
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Oturum açın" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  const channelId = q.get("channel") ?? "";
  if (!(await prisma.channel.findUnique({ where: { id: channelId } }))) return NextResponse.json({ error: "Kanal bulunamadı" }, { status: 400 });
  const ext = path.extname(q.get("name") ?? "").toLowerCase() || ".mp4";
  if (!EXT.has(ext)) return NextResponse.json({ error: `Desteklenmeyen dosya türü: ${ext}` }, { status: 400 });
  if (!req.body) return NextResponse.json({ error: "Dosya yok" }, { status: 400 });
  const dir = path.join(MEDIA_DIR, "uploads");
  await fs.promises.mkdir(dir, { recursive: true });
  const out = path.join(dir, `${crypto.randomBytes(8).toString("hex")}${ext}`);
  try {
    await pipeline(Readable.fromWeb(req.body as unknown as NodeWebStream), fs.createWriteStream(out));
  } catch (e) {
    await fs.promises.rm(out, { force: true });
    return NextResponse.json({ error: `Yükleme yarıda kaldı: ${(e as Error).message}` }, { status: 500 });
  }
  const id = await createClip({
    channelId,
    sourcePath: out,
    narrate: q.get("narrate") === "1",
    targetSeconds: Math.min(60, Math.max(15, Number(q.get("seconds")) || 35)),
    note: (q.get("note") ?? "").slice(0, 500),
    publishNow: q.get("publish") === "1",
  });
  return NextResponse.json({ id });
}
