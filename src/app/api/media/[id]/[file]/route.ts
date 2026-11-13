import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { MEDIA_DIR } from "@/lib/paths";
import { isAuthed } from "@/lib/auth";

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg" };

export async function GET(req: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  if (!(await isAuthed())) return new Response("Unauthorized", { status: 401 });
  const { id, file } = await params;
  if (!/^[a-z0-9]+$/i.test(id) || !/^[\w.-]+$/.test(file) || file.includes("..")) return new Response("Bad request", { status: 400 });
  const p = path.join(MEDIA_DIR, id, file);
  if (!p.startsWith(MEDIA_DIR + path.sep) || !fs.existsSync(p)) return new Response("Not found", { status: 404 });
  const size = fs.statSync(p).size;
  const type = TYPES[path.extname(p)] ?? "application/octet-stream";
  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m?.[1] ? Number(m[1]) : 0;
    const end = m?.[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    const stream = Readable.toWeb(fs.createReadStream(p, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(p)) as ReadableStream;
  return new Response(stream, { headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" } });
}
