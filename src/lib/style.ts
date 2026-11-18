import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db";
import { ffmpeg } from "./ffmpeg";
import { probe, sampleFrames } from "./video";
import { transcribe, type Word } from "./tts";
import { analyzeStyle, type StyleProfileT } from "./claude";
import { getSettings } from "./settings";
import { MEDIA_DIR } from "./paths";
import { log } from "./log";

/**
 * Sahne kesmelerini bulur: saniyede 2 kare küçük gri görüntüye çevrilir, ardışık kareler arasındaki fark
 * ani sıçrama yaptığında yeni sahne sayılır. (ffmpeg'in sahne skoru, yumuşak geçişli ve sürekli hareketli
 * çizim videolarında kesmeleri kaçırdığı için bu yöntem kullanılır.)
 */
export async function detectCuts(file: string, dir: string): Promise<number[]> {
  const W = 36, H = 64, FPS = 2;
  const raw = path.join(dir, "gray.raw");
  await ffmpeg(["-i", file, "-an", "-vf", `fps=${FPS},scale=${W}:${H},format=gray`, "-f", "rawvideo", raw]);
  const buf = await fs.readFile(raw);
  await fs.rm(raw, { force: true });
  const n = W * H;
  const diffs: number[] = [];
  for (let f = n; f + n <= buf.length; f += n) {
    let d = 0;
    for (let k = 0; k < n; k++) d += Math.abs(buf[f + k] - buf[f - n + k]);
    diffs.push(d / n);
  }
  const sorted = [...diffs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const th = Math.max(18, median * 4);
  const cuts: number[] = [];
  for (let k = 0; k < diffs.length; k++) {
    if (diffs[k] < th) continue;
    const t = (k + 1) / FPS;
    if (!cuts.length || t - cuts.at(-1)! > 0.75) cuts.push(t); // art arda gelen (geçişli) sıçramalar tek kesme
  }
  return cuts;
}

/** /api/media/ref<kanal>/… adresinden sunulabilsin diye klasör adı yalnızca harf/rakam */
export const styleDir = (channelId: string) => path.join(MEDIA_DIR, `ref${channelId}`);

/**
 * Örnek videoyu çözümler: tempo (kesmeler), konuşma hızı (döküm), kareler → Claude tarz profili.
 * Arka planda çalışır; durum kanalın styleStatus alanında tutulur.
 */
export async function analyzeReference(channelId: string, note = "") {
  const ch = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
  if (!ch.styleRefPath) throw new Error("Örnek video yok");
  await prisma.channel.update({ where: { id: channelId }, data: { styleStatus: "analiz" } });
  const dir = styleDir(channelId);
  try {
    const info = await probe(ch.styleRefPath);
    if (!info.duration) throw new Error("Video okunamadı");
    if (info.duration > 600) throw new Error("Örnek video en fazla 10 dakika olabilir");

    const cuts = (await detectCuts(ch.styleRefPath, dir)).filter((t) => t > 0.3 && t < info.duration - 0.3);
    const avgSceneSeconds = info.duration / (cuts.length + 1);

    let words: Word[] = [];
    const s = await getSettings();
    if (info.hasAudio) {
      try {
        const a = path.join(dir, "audio.mp3");
        await ffmpeg(["-i", ch.styleRefPath, "-vn", "-ac", "1", "-b:a", "64k", a]);
        words = await transcribe(a, ch.language || s.language);
        await fs.rm(a, { force: true });
      } catch (e) {
        await log(`Örnek video: konuşma tanınamadı (${(e as Error).message.slice(0, 120)}); sadece görüntü incelenecek`, { level: "warn" });
      }
    }
    const speech = words.length > 8 ? words.at(-1)!.end - words[0].start : 0;
    const wordsPerMinute = speech > 5 ? (words.length / speech) * 60 : null;

    // Kesmelerin hemen sonrasından ve eşit aralıklardan kareler
    const frames = await sampleFrames(ch.styleRefPath, dir, info.duration, Math.min(20, Math.max(8, Math.round(info.duration / 3))));
    const profile = await analyzeStyle({
      frames: await Promise.all(frames.map(async (f) => ({ t: f.t, jpegBase64: (await fs.readFile(f.path)).toString("base64") }))),
      duration: info.duration,
      transcript: words.length ? words.map((w) => w.word).join(" ").slice(0, 6000) : null,
      avgSceneSeconds,
      cuts: cuts.length,
      wordsPerMinute,
      format: ch.contentFormat,
      note,
    });
    await Promise.all(frames.slice(1).map((f) => fs.rm(f.path, { force: true })));
    if (frames[0]) await fs.rename(frames[0].path, path.join(dir, "thumb.jpg")).catch(() => {});
    const full: StyleProfileT = {
      ...profile,
      seconds: info.duration,
      avgSceneSeconds,
      wordsPerMinute,
      analyzedAt: new Date().toISOString(),
    };
    await prisma.channel.update({ where: { id: channelId }, data: { styleProfile: JSON.stringify(full), styleStatus: "" } });
    await log(`Örnek video çözümlendi (${ch.name}): ${cuts.length} kesme, ortalama sahne ${avgSceneSeconds.toFixed(1)} sn`);
  } catch (e) {
    const msg = (e as Error).message;
    await prisma.channel.update({ where: { id: channelId }, data: { styleStatus: `hata: ${msg.slice(0, 300)}` } });
    await log(`Örnek video çözümlenemedi: ${msg}`, { level: "error" });
  }
}

/** Profili kanal ayarlarına yansıtır (görsel stil, altyazı, müzik, ton, süre) ve tarzı açar */
export async function applyStyleToChannel(channelId: string) {
  const ch = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
  const p = ch.styleProfile ? (JSON.parse(ch.styleProfile) as StyleProfileT) : null;
  if (!p) throw new Error("Önce örnek videoyu çözümleyin");
  await prisma.channel.update({
    where: { id: channelId },
    data: {
      styleOn: true,
      visualStyle: p.visualStyle,
      subtitleStyle: p.captionStyle,
      musicPrompt: p.musicPrompt,
      channelStyle: p.channelTone,
      ...(ch.contentFormat === "story" ? { storyMinutes: Math.min(2.8, Math.max(1, Math.round((p.seconds / 60) * 10) / 10)) } : {}),
    },
  });
}
