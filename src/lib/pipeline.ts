import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db";
import { getSettings } from "./settings";
import { log } from "./log";
import { itemDir, exists } from "./paths";
import { planScenes, researchNiche, generateCalendarChunk } from "./claude";
import { synthesize, type Word } from "./tts";
import { generateImage } from "./images";
import { renderVideo, timeScenes, type Scene } from "./video";
import { uploadShort } from "./youtube";
import { addDaysYmd, parsePublishTimes, ymdInTz, zonedToUtc } from "./time";

// Aynı süreç içinde paralel çalışmayı engelleyen basit kilit
const g = globalThis as unknown as { __busy?: Set<string>; __calendarJob?: CalendarJob };
const busy = (g.__busy ??= new Set<string>());

export type CalendarJob = { running: boolean; startedAt: Date; message: string; error?: string };
export const calendarJob = () => g.__calendarJob;

/** Niş araştırması + N günlük içerik takvimi (taslak olarak kaydedilir) */
export async function generateCalendar(days = 30) {
  if (g.__calendarJob?.running) throw new Error("Takvim üretimi zaten sürüyor");
  const job: CalendarJob = (g.__calendarJob = { running: true, startedAt: new Date(), message: "Araştırma yapılıyor" });
  try {
    const s = await getSettings();
    if (!s.niche.trim()) throw new Error("Önce Ayarlar'dan niş/kategori girin");
    const times = parsePublishTimes(s.publishTimes).slice(0, Math.max(1, s.videosPerDay));
    while (times.length < s.videosPerDay) times.push(times.at(-1)!);
    const total = days * s.videosPerDay;

    // Takvim, mevcut son planlı günden sonra başlar
    const last = await prisma.contentItem.findFirst({ orderBy: { publishAt: "desc" } });
    const today = ymdInTz(new Date(), s.timezone);
    const lastDay = last ? ymdInTz(last.publishAt, s.timezone) : today;
    const startDay = addDaysYmd(lastDay > today ? lastDay : today, 1);
    const lastIndex = last?.dayIndex ?? 0;

    await log(`Takvim üretimi başladı: ${days} gün, günde ${s.videosPerDay} video, niş "${s.niche}"`);
    const research = await researchNiche(s);
    await log(`Araştırma tamamlandı (${research.length} karakter)`);

    const previous = await prisma.contentItem.findMany({ select: { topic: true }, orderBy: { publishAt: "desc" }, take: 100 });
    const avoid = previous.map((p) => p.topic);
    let made = 0;
    const CHUNK = 6;
    while (made < total) {
      const n = Math.min(CHUNK, total - made);
      job.message = `Senaryolar yazılıyor (${made}/${total})`;
      const items = await generateCalendarChunk(s, research, n, avoid);
      for (const it of items) {
        const k = made++;
        const day = Math.floor(k / s.videosPerDay);
        const slot = k % s.videosPerDay;
        await prisma.contentItem.create({
          data: {
            dayIndex: lastIndex + day + 1,
            publishAt: zonedToUtc(addDaysYmd(startDay, day), times[slot], s.timezone),
            topic: it.topic,
            hook: it.hook,
            script: it.script,
            title: it.title,
            description: it.description,
            tags: JSON.stringify(it.tags),
          },
        });
        avoid.push(it.topic);
      }
      if (!items.length) break;
    }
    job.message = `Tamamlandı: ${made} video planlandı`;
    await log(job.message);
  } catch (e) {
    job.error = (e as Error).message;
    job.message = "Hata";
    await log(`Takvim üretimi başarısız: ${job.error}`, { level: "error" });
  } finally {
    job.running = false;
  }
}

/** Tek bir içeriği uçtan uca videoya dönüştürür */
export async function produceItem(id: string) {
  if (busy.has(id)) return;
  // Durumu atomik olarak sahiplen
  const claimed = await prisma.contentItem.updateMany({
    where: { id, status: { in: ["APPROVED", "FAILED", "READY"] } },
    data: { status: "PRODUCING", error: null, attempts: { increment: 1 } },
  });
  if (!claimed.count) return;
  busy.add(id);
  try {
    const s = await getSettings();
    const item = await prisma.contentItem.findUniqueOrThrow({ where: { id } });
    const dir = await itemDir(id);
    await log("Üretim başladı", { itemId: id });

    // 1) Ses + kelime zamanları
    const audioPath = path.join(dir, "voice.mp3");
    const wordsPath = path.join(dir, "words.json");
    let words: Word[];
    let duration: number;
    if ((await exists(audioPath)) && (await exists(wordsPath))) {
      ({ words, duration } = JSON.parse(await fs.readFile(wordsPath, "utf8")));
    } else {
      const tts = await synthesize(s.ttsProvider, item.script, s.elevenVoiceId, audioPath);
      words = tts.words;
      duration = tts.duration;
      await fs.writeFile(wordsPath, JSON.stringify({ words, duration }));
      await log(`Seslendirme hazır (${duration.toFixed(1)} sn, ${s.ttsProvider})`, { itemId: id });
    }
    if (duration > 62) await log(`Uyarı: ses ${duration.toFixed(0)} sn, 60 sn üstü`, { itemId: id, level: "warn" });

    // 2) Sahne planı (görsel istemleri)
    let scenes: Scene[];
    const existing = item.scenes ? (JSON.parse(item.scenes) as Scene[]) : null;
    if (existing?.length) {
      scenes = timeScenes(existing, words, duration).map((sc, i) => ({ ...sc, image: existing[i].image }));
    } else {
      const plan = await planScenes(s, item.script, item.topic);
      const styled = plan.scenes.map((sc) => ({
        text: sc.text,
        imagePrompt: `${s.visualStyle}. ${plan.styleAnchor}. ${sc.imagePrompt}. Vertical 9:16 composition, no text, no letters, no watermark.`,
      }));
      scenes = timeScenes(styled, words, duration);
      await log(`${scenes.length} sahne planlandı`, { itemId: id });
    }

    // 3) Görseller (var olanlar atlanır; yarıda kalan üretim kaldığı yerden devam eder)
    const seedBase = Math.abs([...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7));
    for (let i = 0; i < scenes.length; i++) {
      const img = path.join(dir, `scene_${String(i).padStart(2, "0")}.png`);
      if (!(await exists(img))) {
        await generateImage(s.imageProvider, scenes[i].imagePrompt, img, seedBase + i);
      }
      scenes[i].image = img;
      await prisma.contentItem.update({ where: { id }, data: { scenes: JSON.stringify(scenes) } });
    }
    await log(`Görseller hazır (${s.imageProvider})`, { itemId: id });

    // 4) Montaj
    const outPath = path.join(dir, "short.mp4");
    await renderVideo({ dir, scenes, audioPath, words, outPath });
    await prisma.contentItem.update({
      where: { id },
      data: { status: "READY", audioPath, videoPath: outPath, scenes: JSON.stringify(scenes) },
    });
    await log("Video hazır", { itemId: id });
  } catch (e) {
    await prisma.contentItem.update({ where: { id }, data: { status: "FAILED", error: (e as Error).message } });
    await log(`Üretim hatası: ${(e as Error).message}`, { itemId: id, level: "error" });
  } finally {
    busy.delete(id);
  }
}

/** Hazır videoyu YouTube'a yükler (ileri tarihliyse YouTube zamanlamasıyla) */
export async function uploadItem(id: string) {
  const claimed = await prisma.contentItem.updateMany({
    where: { id, status: "READY" },
    data: { status: "UPLOADING", error: null },
  });
  if (!claimed.count) return;
  try {
    const s = await getSettings();
    const item = await prisma.contentItem.findUniqueOrThrow({ where: { id } });
    if (!item.videoPath) throw new Error("Video dosyası yok");
    const videoId = await uploadShort({
      filePath: item.videoPath,
      title: item.title,
      description: item.description,
      tags: JSON.parse(item.tags),
      language: s.language,
      privacyStatus: s.privacyStatus,
      publishAt: item.publishAt,
    });
    await prisma.contentItem.update({ where: { id }, data: { status: "UPLOADED", youtubeVideoId: videoId } });
    await log(`YouTube'a yüklendi: https://youtube.com/shorts/${videoId}`, { itemId: id });
  } catch (e) {
    // Video hazır kalsın; panelden tekrar denenebilir
    await prisma.contentItem.update({ where: { id }, data: { status: "READY", error: `Yükleme: ${(e as Error).message}` } });
    await log(`Yükleme hatası: ${(e as Error).message}`, { itemId: id, level: "error" });
  }
}

/** Zamanlayıcı turu: zamanı gelen onaylı içerikleri üretir, hazır olanları yükler */
export async function tick() {
  const s = await getSettings();
  const now = Date.now();
  const yt = await prisma.youtubeAccount.findUnique({ where: { id: 1 } });

  if (s.autoProduce) {
    const due = await prisma.contentItem.findMany({
      where: { status: "APPROVED", publishAt: { lte: new Date(now + s.produceHoursAhead * 3600_000) } },
      orderBy: { publishAt: "asc" },
      take: 2,
    });
    for (const it of due) await produceItem(it.id);

    if (yt) {
      const ready = await prisma.contentItem.findMany({
        // dayIndex 0 = `npm run demo` ile oluşturulan deneme videosu, otomatik yüklenmez
        where: { status: "READY", error: null, dayIndex: { gt: 0 } },
        orderBy: { publishAt: "asc" },
        take: 3,
      });
      for (const it of ready) await uploadItem(it.id);
    }
  }

  // Takılı kalmış işler (ör. süreç çöktü): 1 saatten eskiyse FAILED yap
  await prisma.contentItem.updateMany({
    where: { status: { in: ["PRODUCING", "UPLOADING"] }, updatedAt: { lt: new Date(now - 3600_000) } },
    data: { status: "FAILED", error: "İşlem yarıda kaldı, tekrar deneyin" },
  });
}
