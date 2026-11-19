import fs from "node:fs/promises";
import path from "node:path";
import type { ContentItem } from "@prisma/client";
import { prisma } from "./db";
import { log } from "./log";
import { itemDir, exists } from "./paths";
import {
  planScenes, researchNiche, generateCalendarChunk, createSeriesBible, writeEpisode,
  generatePromoChunk, writeSalesVideo, planDemoClip, type CalendarItemT,
} from "./claude";
import { effectiveTts, synthesize, transcribe, type Word } from "./tts";
import { generateImage } from "./images";
import { renderVideo, renderClip, timeScenes, probe, sampleFrames, type Scene, type Overlays } from "./video";
import { musicFor } from "./music";
import { uploadShort, countVotes, fetchStats } from "./youtube";
import { friendlyError } from "./errors";
import { uploadTiktok } from "./tiktok";
import { uploadReel } from "./instagram";
import { channelSettings, listChannels, type ChannelSettings } from "./channels";
import { addDaysYmd, parsePublishTimes, ymdInTz, zonedToUtc } from "./time";
import { avoidLines, channelCorpus, describeMatch, findDuplicate, overusedOpeners, seedOf } from "./originality";

/** API hatalarını anlaşılır Türkçe mesaja çevirir */
function explain(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  if (/^401\b/.test(msg) && /x-api-key|authentication/.test(msg)) return "Claude API anahtarı geçersiz (Ayarlar → API anahtarları)";
  if (/^429\b/.test(msg)) return "Claude kullanım sınırına takıldı, biraz sonra tekrar deneyin";
  if (/credit balance/i.test(msg)) return "Claude hesabında kredi yok (console.anthropic.com → Billing)";
  return friendlyError(msg);
}

/** Açılış kancası için kısa başlık: başlığın ":" öncesi, etiket/emoji olmadan, en fazla ~42 karakter */
function hookOf(title: string, topic: string) {
  const base = (title || topic).split(/\s[:|–—-]\s|:\s/)[0].replace(/#\S+/g, "").replace(/[\p{Extended_Pictographic}]/gu, "").trim();
  if (base.length <= 42) return base;
  const cut = base.slice(0, 42);
  return cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

const isPromoChannel = (s: ChannelSettings) => s.channel.contentFormat === "promo";

/** Tanıtım/satış/klip videolarında kapanış kartı */
function promoCardOf(s: ChannelSettings): Overlays["promoCard"] {
  const ch = s.channel;
  const name = ch.productName || ch.name;
  const url = ch.productUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return { title: name, cta: ch.cta || url, url: ch.cta ? url : "", color: ch.primaryColor, start: 0, end: 0 };
}

const brandOf = (s: ChannelSettings) => ({ primaryColor: s.channel.primaryColor, logoPath: s.channel.logoPath });

// Aynı süreç içinde paralel çalışmayı engelleyen basit kilit
const g = globalThis as unknown as { __busy?: Set<string>; __calendarJobs?: Map<string, CalendarJob> };
const busy = (g.__busy ??= new Set<string>());
const jobs = (g.__calendarJobs ??= new Map<string, CalendarJob>());

export type CalendarJob = { running: boolean; startedAt: Date; message: string; error?: string };
export const calendarJob = (channelId: string) => jobs.get(channelId);

/** Niş/ürün araştırması + N günlük içerik takvimi (taslak olarak kaydedilir) */
export async function generateCalendar(channelId: string, days = 30) {
  if (jobs.get(channelId)?.running) throw new Error("Bu kanal için takvim üretimi zaten sürüyor");
  const job: CalendarJob = { running: true, startedAt: new Date(), message: "Araştırma yapılıyor" };
  jobs.set(channelId, job);
  try {
    const s = await channelSettings(channelId);
    const promo = isPromoChannel(s);
    if (s.contentFormat === "story")
      throw new Error("Hikâye dizisi modunda bölümler izleyici oylarına göre tek tek yazılır; Panel'den 'Yeni bölüm üret' kullanın");
    if (promo && !s.channel.productName.trim()) throw new Error("Önce kanal ayarlarından ürün adını ve çözdüğü sorunu girin");
    if (!promo && !s.niche.trim()) throw new Error("Önce kanal ayarlarından niş/kategori girin");
    const times = parsePublishTimes(s.publishTimes).slice(0, Math.max(1, s.videosPerDay));
    while (times.length < s.videosPerDay) times.push(times.at(-1)!);
    const total = days * s.videosPerDay;

    // Takvim, kanalın son planlı gününden sonra başlar
    const last = await prisma.contentItem.findFirst({ where: { channelId, kind: "standard" }, orderBy: { publishAt: "desc" } });
    const today = ymdInTz(new Date(), s.timezone);
    const lastDay = last ? ymdInTz(last.publishAt, s.timezone) : today;
    const startDay = addDaysYmd(lastDay > today ? lastDay : today, 1);
    const lastIndex = last?.dayIndex ?? 0;

    await log(`[${s.channel.name}] Takvim üretimi başladı: ${days} gün, günde ${s.videosPerDay} video`);
    const researchFor = promo
      ? { ...s, niche: `${s.channel.targetAudience || s.channel.productName} — günlük iş sorunları, ${s.channel.productProblem}` }
      : s;
    const research = (await researchNiche(researchFor)) + (await performanceNotes(channelId));
    await log(`[${s.channel.name}] Araştırma tamamlandı`);

    // Özgünlük: kanalın önceki videoları + bu takvimde yazılanlar ile karşılaştırılır
    const corpus = await channelCorpus(channelId);
    const avoid = avoidLines(corpus);
    let made = 0;
    let skipped = 0;
    let rounds = 0;
    const CHUNK = 6;
    while (made < total && rounds++ < Math.ceil(total / CHUNK) + 4) {
      const n = Math.min(CHUNK, total - made);
      job.message = `Senaryolar yazılıyor (${made}/${total})`;
      const overused = overusedOpeners(corpus);
      const items = promo
        ? await generatePromoChunk({ ...s, ...s.channel }, research, n, avoid, overused)
        : await generateCalendarChunk(s, research, n, avoid, overused);
      for (const it of items) {
        const dup = findDuplicate(it, corpus);
        if (dup) {
          skipped++;
          await log(`[${s.channel.name}] Tekrar içerik atlandı: "${it.title}" — ${describeMatch(dup)}`, { level: "warn" });
          avoid.unshift(`${it.title} (çok benzer bulundu, bu açıdan uzak dur)`);
          continue;
        }
        const k = made++;
        const day = Math.floor(k / s.videosPerDay);
        const slot = k % s.videosPerDay;
        await prisma.contentItem.create({
          data: {
            channelId,
            dayIndex: lastIndex + day + 1,
            publishAt: zonedToUtc(addDaysYmd(startDay, day), times[slot], s.timezone),
            ...itemFields(it),
          },
        });
        avoid.unshift(avoidLines([it])[0]);
        corpus.unshift(it);
      }
      if (!items.length) break;
    }
    job.message = `Tamamlandı: ${made} video planlandı${skipped ? ` (${skipped} benzer metin elendi)` : ""}`;
    await log(`[${s.channel.name}] ${job.message}`);
  } catch (e) {
    job.error = explain(e);
    job.message = "Hata";
    await log(`Takvim üretimi başarısız: ${job.error}`, { level: "error" });
  } finally {
    job.running = false;
  }
}

const itemFields = (it: CalendarItemT) => ({
  topic: it.topic, hook: it.hook, script: it.script, title: it.title,
  description: it.description, tags: JSON.stringify(it.tags),
});

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
  const progress = (m: string | null) => prisma.contentItem.update({ where: { id }, data: { progress: m } }).then(() => undefined);
  // Canlılık sinyali: üretim sürdükçe kayıt 30 sn'de bir dokunulur. Sinyal kesilirse (sunucu
  // güncellendi/yeniden başladı) zamanlayıcı işi yarıda kalmış sayıp kaldığı yerden sürdürür.
  const alive = setInterval(() => {
    prisma.contentItem.updateMany({ where: { id, status: "PRODUCING" }, data: { updatedAt: new Date() } }).catch(() => {});
  }, 30_000);
  try {
    const item = await prisma.contentItem.findUniqueOrThrow({ where: { id } });
    const s = await channelSettings(item.channelId);
    await log("Üretim başladı", { itemId: id });
    if (item.kind === "clip") await produceClip(item, s, progress);
    else await produceStandard(item, s, progress);
    await log("Video hazır", { itemId: id });
  } catch (e) {
    await prisma.contentItem.update({ where: { id }, data: { status: "FAILED", error: explain(e), progress: null } });
    await log(`Üretim hatası: ${explain(e)}`, { itemId: id, level: "error" });
  } finally {
    clearInterval(alive);
    busy.delete(id);
  }
}

/**
 * Sunucu yeniden başlarken (ör. güncelleme) yarıda kalan üretimleri bulur ve kaldığı yerden sürdürür.
 * Ses ve sahne görselleri önbellekte olduğu için sadece eksik kısımlar yeniden yapılır.
 */
export async function resumeOrphaned() {
  const stale = new Date(Date.now() - 3 * 60_000);
  const orphans = await prisma.contentItem.findMany({
    where: { status: "PRODUCING", updatedAt: { lt: stale } },
    select: { id: true, attempts: true },
  });
  for (const o of orphans) {
    if (busy.has(o.id)) continue;
    if (o.attempts >= 10) {
      await prisma.contentItem.update({
        where: { id: o.id },
        data: { status: "FAILED", error: "Üretim defalarca yarıda kaldı; \"Yeniden üret\" ile tekrar deneyin", progress: null },
      });
      continue;
    }
    await prisma.contentItem.update({ where: { id: o.id }, data: { status: "FAILED", progress: null } });
    await log("Üretim yarıda kalmıştı (sunucu yeniden başladı), kaldığı yerden sürdürülüyor", { itemId: o.id, level: "warn" });
    void produceItem(o.id);
  }
}

type Progress = (m: string | null) => Promise<void>;

/** Seslendirme (önbellekli): voice.mp3 + words.json */
async function voiceFor(item: ContentItem, s: ChannelSettings, dir: string, text: string) {
  const audioPath = path.join(dir, "voice.mp3");
  const wordsPath = path.join(dir, "words.json");
  const want = await effectiveTts(s.ttsProvider);
  if ((await exists(audioPath)) && (await exists(wordsPath))) {
    const cached = JSON.parse(await fs.readFile(wordsPath, "utf8")) as { words: Word[]; duration: number; provider?: string; text?: string };
    // Önceden "Deneme" ile üretilmiş sessiz ses ya da değişmiş metin yeniden seslendirilir
    const sameProvider = (cached.provider ?? "mock") === want || want === "mock";
    if (sameProvider && (cached.text === undefined || cached.text === text)) {
      return { audioPath, words: cached.words, duration: cached.duration };
    }
  }
  if (s.ttsProvider !== want) await log(`ElevenLabs anahtarı bulundu, "Deneme" yerine ElevenLabs ile seslendiriliyor`, { itemId: item.id });
  const tts = await synthesize(s.ttsProvider, text, s.elevenVoiceId, audioPath);
  await fs.writeFile(wordsPath, JSON.stringify({ words: tts.words, duration: tts.duration, provider: tts.provider, text }));
  await log(`Seslendirme hazır (${tts.duration.toFixed(1)} sn, ${tts.provider})`, { itemId: item.id });
  return { audioPath, words: tts.words, duration: tts.duration };
}

async function produceStandard(item: ContentItem, s: ChannelSettings, progress: Progress) {
  const id = item.id;
  const dir = await itemDir(id);
  const isStory = item.episodeNumber != null;
  const isPromo = !isStory && (isPromoChannel(s) || item.kind === "sales");
  await progress("Seslendirme");

  // 1) Ses + kelime zamanları
  const { audioPath, words, duration } = await voiceFor(item, s, dir, item.script);
  const limit = isStory ? 175 : 62;
  if (duration > limit) await log(`Uyarı: ses ${duration.toFixed(0)} sn, ${limit} sn üstü`, { itemId: id, level: "warn" });

  // 2) Sahne planı (görsel istemleri)
  await progress("Sahne planı");
  let scenes: Scene[];
  const existing = item.scenes ? (JSON.parse(item.scenes) as Scene[]) : null;
  if (existing?.length) {
    scenes = timeScenes(existing, words, duration).map((sc, i) => ({ ...sc, image: existing[i].image }));
  } else {
    const characters = isStory ? s.seriesCharacters : undefined;
    // Örnek video tarzı açıksa sahne sayısı ölçülen ortalama sahne süresinden hesaplanır
    const promoChars = `The product "${s.channel.productName}" is software: show it as a simple glowing app screen/dashboard with abstract UI blocks (no readable text). Brand colors ${s.channel.primaryColor} and ${s.channel.accentColor}.`;
    const ref = s.styleGuide;
    const refN = ref ? Math.min(40, Math.max(4, Math.round(duration / Math.max(1.2, ref.avgSceneSeconds)))) : 0;
    const plan = ref
      ? await planScenes(s, item.script, item.topic, {
          minScenes: Math.max(3, refN - 2),
          maxScenes: refN + 2,
          characters: isStory ? characters : isPromo ? promoChars : undefined,
        })
      : isStory
      ? await planScenes(s, item.script, item.topic, {
          minScenes: Math.max(10, Math.round(s.storyMinutes * 6)),
          maxScenes: Math.max(14, Math.round(s.storyMinutes * 9)),
          characters,
        })
      : await planScenes(s, item.script, item.topic, {
          minScenes: isPromo ? 7 : 9,
          maxScenes: isPromo ? 10 : 13,
          characters: isPromo ? promoChars : undefined,
        });
    const styled = plan.scenes.map((sc) => ({
      text: sc.text,
      imagePrompt: `${s.visualStyle}. ${plan.styleAnchor}. ${sc.imagePrompt}. Vertical 9:16 composition, no text, no letters, no watermark.`,
    }));
    scenes = timeScenes(styled, words, duration);
    await log(`${scenes.length} sahne planlandı`, { itemId: id });
  }

  // 3) Görseller (var olanlar atlanır; yarıda kalan üretim kaldığı yerden devam eder)
  const seedBase = Math.abs([...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7));
  // Claude çizimi yavaş olduğundan aynı anda 4 sahne çizilir
  const parallelism = s.imageProvider === "claude" ? 4 : 1;
  let next = 0;
  let done = 0;
  await progress(`Görseller 0/${scenes.length}`);
  const ctx = { characters: isStory ? s.seriesCharacters : undefined };
  const workers = Array.from({ length: parallelism }, async () => {
    while (next < scenes.length) {
      const i = next++;
      const img = path.join(dir, `scene_${String(i).padStart(2, "0")}.png`);
      if (!(await exists(img))) await generateImage(s.imageProvider, scenes[i].imagePrompt, img, seedBase + i, ctx);
      scenes[i].image = img;
      done++;
      await prisma.contentItem.update({
        where: { id },
        data: { scenes: JSON.stringify(scenes), progress: `Görseller ${done}/${scenes.length}` },
      });
    }
  });
  await Promise.all(workers);
  await log(`Görseller hazır (${s.imageProvider})`, { itemId: id });

  // 4) Montaj
  const outPath = path.join(dir, "short.mp4");
  await renderVideo({
    dir, scenes, audioPath, words, outPath,
    motion: s.styleGuide?.motion ?? (isStory ? "slow" : "normal"),
    transition: s.styleGuide?.transition ?? (isStory ? "fade" : "varied"),
    endCardSeconds: isStory && item.choiceA ? 5 : isPromo ? 3 : 0,
    variant: seedOf(id),
    musicVolume: s.musicVolume,
    musicPath: await musicFor(s, isStory, duration, (m, warn) => log(m, { itemId: id, level: warn ? "warn" : "info" })),
    fx: { particles: s.particles, progressBar: s.progressBar, sfx: s.sfx, vignette: true },
    brand: brandOf(s),
    onProgress: progress,
    overlays: {
      subtitleStyle: s.subtitleStyle as "karaoke" | "minimal" | "off",
      watermark: s.watermark,
      highlight: s.channel.primaryColor,
      ...(!isStory && s.hookText ? { hook: hookOf(item.title, item.topic) } : {}),
      ...(isPromo ? { promoCard: promoCardOf(s) } : {}),
      ...(isStory
        ? {
            titleCard: { title: s.seriesTitle || "Hikâye", badge: `Bölüm ${item.episodeNumber} · ${item.topic}` },
            ...(item.choiceA && item.choiceB ? { endCard: { choiceA: item.choiceA, choiceB: item.choiceB, start: 0, end: 0 } } : {}),
          }
        : {}),
    },
  });
  await prisma.contentItem.update({
    where: { id },
    data: { status: "READY", audioPath, videoPath: outPath, scenes: JSON.stringify(scenes), progress: null },
  });
}

// ---------------- Demo videosundan klip ----------------

type ClipPlan = { segments: { start: number; end: number }[]; hook: string; narrate: boolean; voiceover: string };

/** Kayıtlı klip planına göre dikey videoyu (yeniden) oluşturur */
async function produceClip(item: ContentItem, s: ChannelSettings, progress: Progress) {
  if (!item.sourceVideo || !item.scenes) throw new Error("Klip planı yok; videoyu yeniden yükleyin");
  const plan = JSON.parse(item.scenes) as ClipPlan;
  const dir = await itemDir(item.id);
  let voicePath: string | null = null;
  let words: Word[] = [];
  if (plan.narrate && plan.voiceover.trim()) {
    await progress("Seslendirme");
    const v = await voiceFor(item, s, dir, plan.voiceover);
    voicePath = v.audioPath;
    words = v.words;
  } else {
    // Kaynaktaki konuşmanın altyazısı: kelimeler kesilen bölümlerin zaman çizelgesine taşınır
    const tPath = path.join(dir, "transcript.json");
    if (await exists(tPath)) {
      const src = JSON.parse(await fs.readFile(tPath, "utf8")) as Word[];
      let offset = 0;
      for (const sg of plan.segments) {
        for (const w of src) {
          if (w.start >= sg.start && w.end <= sg.end + 0.2)
            words.push({ word: w.word, start: w.start - sg.start + offset, end: Math.min(w.end, sg.end) - sg.start + offset });
        }
        offset += sg.end - sg.start;
      }
    }
  }
  await progress("Montaj: dikey klip");
  const outPath = path.join(dir, "short.mp4");
  const { duration } = await renderClip({
    dir,
    source: item.sourceVideo,
    segments: plan.segments,
    words,
    voicePath,
    keepSourceAudio: !voicePath,
    outPath,
    endCardSeconds: 3,
    brand: brandOf(s),
    fx: { progressBar: s.progressBar },
    musicVolume: s.musicVolume,
    musicPath: await musicFor(s, false, 60, (m, warn) => log(m, { itemId: item.id, level: warn ? "warn" : "info" })),
    overlays: {
      subtitleStyle: s.subtitleStyle as "karaoke" | "minimal" | "off",
      highlight: s.channel.primaryColor,
      hook: s.hookText ? plan.hook : undefined,
      promoCard: promoCardOf(s),
    },
  });
  await prisma.contentItem.update({
    where: { id: item.id },
    data: { status: "READY", videoPath: outPath, audioPath: voicePath, progress: null },
  });
  await log(`Klip hazır (${duration.toFixed(0)} sn)`, { itemId: item.id });
}

/**
 * Yüklenen demo videosundan klip: kareler + konuşma dökümü Claude'a gösterilir,
 * en iyi bölümleri seçer, kanca/anlatım/başlık yazar; ardından dikey video üretilir.
 */
export async function createClip(opts: {
  channelId: string;
  sourcePath: string;
  narrate: boolean;
  targetSeconds: number;
  note: string;
  publishNow: boolean;
}) {
  const item = await prisma.contentItem.create({
    data: {
      channelId: opts.channelId, kind: "clip", dayIndex: 0, publishAt: new Date(), sourceVideo: opts.sourcePath,
      topic: "Demo klibi", hook: "", script: "", title: "Demo klibi (hazırlanıyor…)", description: "", tags: "[]",
      status: "WRITING", autoUpload: opts.publishNow, progress: "Video inceleniyor",
    },
  });
  void (async () => {
    const id = item.id;
    try {
      const s = await channelSettings(opts.channelId);
      const dir = await itemDir(id);
      const info = await probe(opts.sourcePath);
      if (!info.duration) throw new Error("Video okunamadı");
      let transcript: Word[] = [];
      if (info.hasAudio && (await effectiveTts(s.ttsProvider)) === "elevenlabs") {
        try {
          const a = path.join(dir, "source_audio.mp3");
          const { ffmpeg } = await import("./ffmpeg");
          await ffmpeg(["-i", opts.sourcePath, "-vn", "-ac", "1", "-b:a", "64k", a]);
          transcript = await transcribe(a, s.language);
          await fs.writeFile(path.join(dir, "transcript.json"), JSON.stringify(transcript));
          await log(`Konuşma dökümü: ${transcript.length} kelime`, { itemId: id });
        } catch (e) {
          await log(`Konuşma tanınamadı, sadece görüntü kullanılacak: ${explain(e)}`, { itemId: id, level: "warn" });
        }
      }
      const hasSpeech = transcript.length > 15;
      const narrate = opts.narrate || !hasSpeech;
      await prisma.contentItem.update({ where: { id }, data: { progress: "Claude en iyi bölümleri seçiyor" } });
      const frames = await sampleFrames(opts.sourcePath, dir, info.duration, 24);
      const plan = await planDemoClip(
        { ...s, ...s.channel },
        {
          frames: await Promise.all(frames.map(async (f) => ({ t: f.t, jpegBase64: (await fs.readFile(f.path)).toString("base64") }))),
          duration: info.duration,
          transcript: hasSpeech ? groupTranscript(transcript) : null,
          targetSeconds: opts.targetSeconds,
          narrate,
          note: opts.note,
        },
      );
      await Promise.all(frames.map((f) => fs.rm(f.path, { force: true })));
      const segments = plan.segments
        .map((sg) => ({ start: Math.max(0, sg.start), end: Math.min(info.duration, sg.end) }))
        .filter((sg) => sg.end - sg.start >= 1);
      if (!segments.length) throw new Error("Claude geçerli bir bölüm seçemedi");
      const clipPlan: ClipPlan = { segments, hook: plan.hook, narrate: narrate && !!plan.voiceover.trim(), voiceover: plan.voiceover };
      await prisma.contentItem.update({
        where: { id },
        data: {
          topic: plan.hook, hook: plan.hook, script: plan.voiceover || transcript.map((w) => w.word).join(" "),
          title: plan.title, description: plan.description, tags: JSON.stringify(plan.tags),
          scenes: JSON.stringify(clipPlan), status: "APPROVED",
        },
      });
      await log(`Klip planı: ${segments.map((sg) => `${sg.start.toFixed(0)}-${sg.end.toFixed(0)} sn`).join(", ")}`, { itemId: id });
      await produceItem(id);
      if (opts.publishNow) await publishItem(id, { force: true });
    } catch (e) {
      await prisma.contentItem.update({
        where: { id },
        data: { status: "FAILED", error: explain(e), progress: null, title: "Demo klibi" },
      });
      await log(`Klip hatası: ${explain(e)}`, { itemId: id, level: "error" });
    }
  })();
  return item.id;
}

/** Zamanlı dökümü Claude için ~5 sn'lik satırlara böler */
function groupTranscript(words: Word[]) {
  const lines: string[] = [];
  let cur: Word[] = [];
  for (const w of words) {
    cur.push(w);
    if (w.end - cur[0].start > 5 || /[.!?]$/.test(w.word)) {
      lines.push(`[${cur[0].start.toFixed(1)}-${w.end.toFixed(1)}] ${cur.map((x) => x.word).join(" ")}`);
      cur = [];
    }
  }
  if (cur.length) lines.push(`[${cur[0].start.toFixed(1)}-${cur.at(-1)!.end.toFixed(1)}] ${cur.map((x) => x.word).join(" ")}`);
  return lines.join("\n");
}

// ---------------- Yayınlama (YouTube, TikTok, Instagram) ----------------

type PlatformState = { ok?: string; error?: string; at?: string };
type PlatformLog = Partial<Record<"youtube" | "tiktok" | "instagram", PlatformState>>;

/**
 * Hazır videoyu kanalın açık ve bağlı platformlarına yükler.
 * YouTube ileri tarihli yayını kendisi zamanlar; TikTok ve Instagram yayın saati gelince yüklenir.
 * force: elle tetiklendiğinde saat ve tekrar bekleme süresi dikkate alınmaz.
 */
export async function publishItem(id: string, opts: { force?: boolean } = {}) {
  const claimed = await prisma.contentItem.updateMany({ where: { id, status: "READY" }, data: { status: "UPLOADING" } });
  if (!claimed.count) return;
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id } });
  const s = await channelSettings(item.channelId);
  const ch = s.channel;
  const conns = await prisma.connection.findMany({ where: { channelId: ch.id } });
  const has = (p: string) => conns.some((c) => c.platform === p);
  const plog: PlatformLog = item.platformLog ? JSON.parse(item.platformLog) : {};
  const due = opts.force || item.publishAt.getTime() <= Date.now() + 2 * 60_000;
  const retryOk = (st?: PlatformState) => opts.force || !st?.error || !st.at || Date.now() - new Date(st.at).getTime() > 30 * 60_000;
  const tags: string[] = JSON.parse(item.tags);
  const caption = `${item.title}\n\n${item.description}`.trim();
  const update: Partial<ContentItem> = {};
  const errors: string[] = [];

  try {
    if (!item.videoPath) throw new Error("Video dosyası yok");
    // Otomatik yüklemeden önce son kontrol: yayınlanmış bir videoyla neredeyse aynıysa beklet.
    // Elle "Yükle" denince (force) kontrol atlanır.
    if (!opts.force && !plog.youtube?.ok && !plog.tiktok?.ok && !plog.instagram?.ok) {
      const published = await prisma.contentItem.findMany({
        where: { channelId: item.channelId, id: { not: id }, OR: [{ status: "UPLOADED" }, { youtubeVideoId: { not: null } }] },
        select: { id: true, title: true, hook: true, script: true },
        orderBy: { publishAt: "desc" },
        take: 300,
      });
      const dup = findDuplicate(item, published);
      if (dup) {
        const msg = `Otomatik yükleme durduruldu: ${describeMatch(dup)}. YouTube tekrarlayan içerikleri cezalandırabilir. Metni değiştirip yeniden üretin ya da yine de yüklemek için "YouTube'a yükle"ye basın.`;
        if (item.error !== msg) await log(msg, { itemId: id, level: "warn" });
        await prisma.contentItem.update({ where: { id }, data: { status: "READY", error: msg } });
        return;
      }
    }
    const targets = [
      { p: "youtube" as const, on: ch.toYoutube, done: !!item.youtubeVideoId, when: true },
      { p: "tiktok" as const, on: ch.toTiktok, done: !!item.tiktokId, when: due },
      { p: "instagram" as const, on: ch.toInstagram, done: !!item.instagramId, when: due },
    ].filter((t) => t.on && has(t.p));

    for (const t of targets) {
      if (t.done || !t.when || !retryOk(plog[t.p])) continue;
      try {
        if (t.p === "youtube") {
          update.youtubeVideoId = await uploadShort({
            channelId: ch.id, filePath: item.videoPath, title: item.title, description: item.description, tags,
            language: s.language, privacyStatus: s.privacyStatus, publishAt: item.publishAt,
            categoryId: isPromoChannel(s) || item.kind !== "standard" ? "28" : "27",
          });
          plog.youtube = { ok: update.youtubeVideoId, at: new Date().toISOString() };
          await log(`YouTube'a yüklendi: https://youtube.com/shorts/${update.youtubeVideoId}`, { itemId: id });
        } else if (t.p === "tiktok") {
          update.tiktokId = await uploadTiktok({ channelId: ch.id, filePath: item.videoPath, caption, mode: ch.tiktokMode });
          plog.tiktok = { ok: update.tiktokId, at: new Date().toISOString() };
          await log(
            update.tiktokId.startsWith("taslak:")
              ? "TikTok'a taslak olarak gönderildi: TikTok uygulamasındaki bildirimden paylaşın"
              : "TikTok'ta yayınlandı",
            { itemId: id },
          );
        } else {
          update.instagramId = await uploadReel({ channelId: ch.id, filePath: item.videoPath, caption });
          plog.instagram = { ok: update.instagramId, at: new Date().toISOString() };
          await log("Instagram Reels'te yayınlandı", { itemId: id });
        }
      } catch (e) {
        plog[t.p] = { error: explain(e), at: new Date().toISOString() };
        errors.push(`${t.p}: ${explain(e)}`);
        await log(`${t.p} yükleme hatası: ${explain(e)}`, { itemId: id, level: "error" });
      }
    }
    const merged = { ...item, ...update };
    const allDone =
      targets.length > 0 &&
      targets.every((t) => (t.p === "youtube" ? !!merged.youtubeVideoId : t.p === "tiktok" ? !!merged.tiktokId : !!merged.instagramId));
    await prisma.contentItem.update({
      where: { id },
      data: {
        ...update,
        platformLog: JSON.stringify(plog),
        status: allDone ? "UPLOADED" : "READY",
        error: errors.length ? `Yükleme: ${errors.join(" · ")}` : null,
      },
    });
  } catch (e) {
    await prisma.contentItem.update({ where: { id }, data: { status: "READY", error: `Yükleme: ${explain(e)}` } });
    await log(`Yükleme hatası: ${explain(e)}`, { itemId: id, level: "error" });
  }
}

/** Geriye uyumluluk: panelden "Yükle" */
export const uploadItem = (id: string) => publishItem(id, { force: true });

/** Zamanlayıcı turu: her kanal için zamanı gelen içerikleri üretir, hazır olanları yükler */
export async function tick() {
  const channels = await listChannels();
  const s0 = await channelSettings(channels[0]?.id);
  const now = Date.now();

  for (const ch of channels) {
    if (ch.autoProduce && ch.contentFormat === "story") {
      try {
        await ensureNextEpisode(ch.id);
      } catch (e) {
        await log(`[${ch.name}] Bölüm planlanamadı: ${explain(e)}`, { level: "error" });
      }
    }
  }

  const auto = channels.filter((c) => c.autoProduce).map((c) => c.id);
  const due = await prisma.contentItem.findMany({
    where: { channelId: { in: auto }, status: "APPROVED", publishAt: { lte: new Date(now + s0.produceHoursAhead * 3600_000) } },
    orderBy: { publishAt: "asc" },
    take: 2,
  });
  for (const it of due) await produceItem(it.id);

  const withConn = (await prisma.connection.findMany({ select: { channelId: true } })).map((c) => c.channelId);
  const ready = await prisma.contentItem.findMany({
    where: { channelId: { in: auto.filter((a) => withConn.includes(a)) }, status: "READY", autoUpload: true },
    orderBy: { publishAt: "asc" },
    take: 4,
  });
  for (const it of ready) await publishItem(it.id);

  await refreshStats();

  // Yarıda kalan üretimleri sürdür (canlılık sinyali 3 dk'dır gelmiyorsa)
  await resumeOrphaned();

  // Takılı kalmış diğer işler (ör. süreç çöktü): 1 saatten eskiyse FAILED yap
  await prisma.contentItem.updateMany({
    where: { status: { in: ["WRITING", "UPLOADING"] }, updatedAt: { lt: new Date(now - 3600_000) } },
    data: { status: "FAILED", error: "İşlem yarıda kaldı, tekrar deneyin", progress: null },
  });
}

/** Son 60 günde YouTube'a yüklenen videoların istatistiklerini saatte bir günceller */
export async function refreshStats(force = false, channelId?: string) {
  const hourAgo = new Date(Date.now() - 3600_000);
  const conns = await prisma.connection.findMany({ where: { platform: "youtube", ...(channelId ? { channelId } : {}) } });
  let n = 0;
  for (const c of conns) {
    const items = await prisma.contentItem.findMany({
      where: {
        channelId: c.channelId,
        youtubeVideoId: { not: null },
        publishAt: { gte: new Date(Date.now() - 60 * 86400_000), lte: new Date() },
        ...(force ? {} : { OR: [{ statsAt: null }, { statsAt: { lt: hourAgo } }] }),
      },
      select: { id: true, youtubeVideoId: true },
    });
    if (!items.length) continue;
    try {
      const stats = await fetchStats(c.channelId, items.map((i) => i.youtubeVideoId!));
      for (const it of items) {
        const st = stats.get(it.youtubeVideoId!);
        await prisma.contentItem.update({ where: { id: it.id }, data: st ? { ...st, statsAt: new Date() } : { statsAt: new Date() } });
      }
      n += stats.size;
    } catch (e) {
      await log(`İstatistikler alınamadı (${c.accountName}): ${explain(e)}`, { level: "warn" });
    }
  }
  return n;
}

/** Kanalın en iyi ve en zayıf videoları: Claude yeni konu seçerken bunlardan öğrenir */
async function performanceNotes(channelId: string): Promise<string> {
  const rated = await prisma.contentItem.findMany({
    where: { channelId, views: { not: null }, publishAt: { lt: new Date(Date.now() - 2 * 86400_000) } },
    orderBy: { views: "desc" },
    select: { topic: true, title: true, hook: true, views: true, likes: true },
    take: 200,
  });
  if (rated.length < 5) return "";
  const line = (r: (typeof rated)[number]) => `- "${r.title}" (konu: ${r.topic}; kanca: ${r.hook.slice(0, 90)}) → ${r.views} izlenme, ${r.likes ?? 0} beğeni`;
  const top = rated.slice(0, 5).map(line).join("\n");
  const bottom = rated.slice(-3).map(line).join("\n");
  return `\n\nKANALIN GERÇEK PERFORMANS VERİSİ (YouTube):\nEn çok izlenenler:\n${top}\nEn az izlenenler:\n${bottom}\nİyi performans gösteren konu türlerinden, kanca yapılarından ve başlık kalıplarından ilham al; zayıf olanlardan kaçın. Aynı konuları tekrar etme.`;
}

/**
 * İstenildiği anda tek video: Claude metni yazar, video üretilir,
 * `publishNow` ise hemen yüklenir; değilse "Hazır"da bekler.
 */
export async function createQuickVideo(channelId: string, opts: { topicHint: string; publishNow: boolean }): Promise<string> {
  const st = await channelSettings(channelId);
  if (st.contentFormat === "story") {
    const id = await startEpisode(channelId, { publishAt: new Date(), autoUpload: opts.publishNow, topicHint: opts.topicHint });
    void (async () => {
      await finishEpisode(id, opts.topicHint);
      const it = await prisma.contentItem.findUnique({ where: { id } });
      if (it?.status !== "APPROVED") return;
      await produceItem(id);
      if (opts.publishNow) await publishItem(id, { force: true });
    })();
    return id;
  }
  const item = await prisma.contentItem.create({
    data: {
      channelId,
      dayIndex: 0,
      publishAt: new Date(),
      topic: opts.topicHint || "Yeni video",
      hook: "",
      script: "",
      title: opts.topicHint ? `${opts.topicHint} (yazılıyor…)` : "Yeni video (yazılıyor…)",
      description: "",
      tags: "[]",
      status: "WRITING",
      autoUpload: opts.publishNow,
    },
  });
  void runQuickVideo(item.id, channelId, opts.topicHint, opts.publishNow);
  return item.id;
}

async function runQuickVideo(id: string, channelId: string, topicHint: string, publishNow: boolean) {
  try {
    const s = await channelSettings(channelId);
    const promo = isPromoChannel(s);
    if (promo && !s.channel.productName.trim()) throw new Error("Kanal ayarlarından ürün adını girin");
    if (!promo && !s.niche.trim() && !topicHint) throw new Error("Kanal ayarlarından niş girin veya bir konu yazın");
    await log(`Yeni video: metin yazılıyor${topicHint ? ` ("${topicHint}")` : ""}`, { itemId: id });
    const corpus = (await channelCorpus(channelId)).filter((c) => c.id !== id);
    const brief = topicHint
      ? `Bu videonun konusu/açısı kullanıcı tarafından belirlendi: "${topicHint}". Bunu işle.`
      : promo
        ? ""
        : "Ayrı bir araştırma raporu yok; nişte ilgi çekici, doğruluğundan emin olduğun bir konu seç.";
    const notes = await performanceNotes(channelId);
    const avoid = avoidLines(corpus, 60);
    const write = () =>
      promo
        ? generatePromoChunk({ ...s, ...s.channel }, brief + notes, 1, avoid, overusedOpeners(corpus))
        : generateCalendarChunk(s, brief + notes, 1, avoid, overusedOpeners(corpus));
    let [it] = await write();
    if (!it) throw new Error("Claude metin döndürmedi");
    // Önceki bir videoya çok benziyorsa bir kez daha, farklı açıdan yazdır
    const dup = findDuplicate(it, corpus);
    if (dup) {
      await log(`Metin önceki bir videoya çok benziyor, yeniden yazılıyor: ${describeMatch(dup)}`, { itemId: id, level: "warn" });
      avoid.unshift(`${it.title} (çok benzer bulundu, tamamen farklı bir konu/açı seç)`);
      const [again] = await write();
      if (again) it = again;
    }
    await prisma.contentItem.update({ where: { id }, data: { ...itemFields(it), status: "APPROVED" } });
    await log(`Metin hazır: ${it.title}`, { itemId: id });
    await produceItem(id);
    if (publishNow) await publishItem(id, { force: true });
  } catch (e) {
    const cur = await prisma.contentItem.findUnique({ where: { id } });
    await prisma.contentItem.update({
      where: { id },
      data: { status: "FAILED", error: explain(e), title: (cur?.title ?? "").replace(" (yazılıyor…)", "") },
    });
    await log(`Yeni video hatası: ${explain(e)}`, { itemId: id, level: "error" });
  }
}

// ---------------- Satış videoları ----------------

/** Her sektör için ayrı, satış ekibinin müşteriye göndereceği tanıtım videosu (otomatik yayınlanmaz) */
export async function createSalesVideos(channelId: string, sectors: string[]) {
  const s = await channelSettings(channelId);
  if (!s.channel.productName.trim()) throw new Error("Önce kanal ayarlarından ürün bilgilerini girin");
  const ids: string[] = [];
  for (const sector of sectors) {
    const it = await prisma.contentItem.create({
      data: {
        channelId, kind: "sales", sector, dayIndex: 0, publishAt: new Date(), topic: sector, hook: "", script: "",
        title: `${sector} (yazılıyor…)`, description: "", tags: "[]", status: "WRITING", autoUpload: false,
      },
    });
    ids.push(it.id);
  }
  void (async () => {
    for (const id of ids) {
      const it = await prisma.contentItem.findUniqueOrThrow({ where: { id } });
      try {
        const v = await writeSalesVideo({ ...s, ...s.channel }, it.sector!);
        await prisma.contentItem.update({ where: { id }, data: { ...itemFields(v), shareText: v.shareText, status: "APPROVED" } });
        await log(`Satış videosu metni hazır: ${it.sector}`, { itemId: id });
        await produceItem(id);
      } catch (e) {
        await prisma.contentItem.update({ where: { id }, data: { status: "FAILED", error: explain(e), title: it.sector! } });
        await log(`Satış videosu hatası: ${explain(e)}`, { itemId: id, level: "error" });
      }
    }
  })();
  return ids.length;
}

// ---------------- Hikâye dizisi ----------------

/** Bölüm için yer tutucu kayıt oluşturur (metin arka planda yazılır) */
async function startEpisode(channelId: string, opts: { publishAt: Date; autoUpload: boolean; topicHint?: string }) {
  const last = await prisma.contentItem.findFirst({ where: { channelId, episodeNumber: { not: null } }, orderBy: { episodeNumber: "desc" } });
  const n = (last?.episodeNumber ?? 0) + 1;
  const item = await prisma.contentItem.create({
    data: {
      channelId,
      dayIndex: n,
      episodeNumber: n,
      publishAt: opts.publishAt,
      topic: `Bölüm ${n}`,
      hook: "",
      script: "",
      title: `Bölüm ${n} (yazılıyor…)`,
      description: "",
      tags: "[]",
      status: "WRITING",
      autoUpload: opts.autoUpload,
    },
  });
  return item.id;
}

/** Dizi bilgisini hazırlar, önceki bölümün oylarını sayar ve bölümü yazar */
type EpisodeOverride = { chosen: string; text: string; nextChoices?: { a: string; b: string } };

async function finishEpisode(id: string, topicHint = "", override?: EpisodeOverride) {
  try {
    const item = await prisma.contentItem.findUniqueOrThrow({ where: { id } });
    const channelId = item.channelId!;
    let s = await channelSettings(channelId);
    if (!s.seriesPremise.trim() || !s.seriesCharacters.trim() || !s.seriesTitle.trim()) {
      await log("Dizi konusu ve karakterler oluşturuluyor", { itemId: id });
      const bible = await createSeriesBible(s);
      await prisma.channel.update({
        where: { id: channelId },
        data: {
          seriesTitle: s.seriesTitle.trim() || bible.seriesTitle,
          seriesPremise: s.seriesPremise.trim() || bible.premise,
          seriesCharacters: s.seriesCharacters.trim() || bible.characters,
        },
      });
      s = await channelSettings(channelId);
    }
    const previous = await prisma.contentItem.findMany({
      where: { channelId, episodeNumber: { not: null, lt: item.episodeNumber! }, summary: { not: null } },
      orderBy: { episodeNumber: "asc" },
    });

    // Önceki bölümün oyları
    let chosenText: string | undefined;
    let chosen: string | null = null;
    const last = previous.at(-1);
    if (override && last) {
      // Kullanıcı devamı panelden seçti/yazdı: oylar sayılmaz
      chosen = override.chosen;
      chosenText = override.text;
      await log(`Bölüm ${last.episodeNumber} devamı elle seçildi → ${chosen}: ${chosenText}`, { itemId: id });
    } else if (last?.choiceA && last.choiceB) {
      let a = last.votesA ?? 0;
      let b = last.votesB ?? 0;
      const yt = await prisma.connection.findUnique({ where: { channelId_platform: { channelId, platform: "youtube" } } });
      if (last.youtubeVideoId && yt) {
        try {
          ({ a, b } = await countVotes(channelId, last.youtubeVideoId));
          await prisma.contentItem.update({ where: { id: last.id }, data: { votesA: a, votesB: b } });
        } catch (e) {
          await log(`Oylar okunamadı: ${(e as Error).message}`, { itemId: id, level: "warn" });
        }
      }
      if (a !== b) {
        chosen = a > b ? "A" : "B";
        chosenText = a > b ? last.choiceA : last.choiceB;
        await log(`Bölüm ${last.episodeNumber} oyları: A ${a} · B ${b} → ${chosen}: ${chosenText}`, { itemId: id });
      } else {
        await log(`Bölüm ${last.episodeNumber} oyları berabere (A ${a} · B ${b}); hikâyeye en uygun seçenek seçilecek`, { itemId: id });
      }
    }

    const ep = await writeEpisode(s, {
      episodeNumber: item.episodeNumber!,
      previous: previous.slice(-6).map((p) => ({
        episodeNumber: p.episodeNumber!, title: p.topic, summary: p.summary!, choiceA: p.choiceA ?? "", choiceB: p.choiceB ?? "",
        chosen: p.id === last?.id ? chosenText : p.chosen,
      })),
      chosenText,
      topicHint,
      nextChoices: override?.nextChoices,
    });
    const series = s.seriesTitle || "Hikâye";
    await prisma.contentItem.update({
      where: { id },
      data: {
        topic: ep.title,
        hook: ep.script.split(/(?<=[.!?])\s+/)[0] ?? "",
        script: ep.script,
        title: `${series} - Bölüm ${item.episodeNumber}: ${ep.title}`.slice(0, 90),
        description: ep.description,
        tags: JSON.stringify(ep.tags),
        choiceA: ep.choiceA,
        choiceB: ep.choiceB,
        summary: ep.summary,
        chosen: chosenText ? `${chosen}: ${chosenText}` : null,
        status: "APPROVED",
      },
    });
    await log(`Bölüm ${item.episodeNumber} yazıldı: ${ep.title}`, { itemId: id });
  } catch (e) {
    await prisma.contentItem.update({
      where: { id },
      data: { status: "FAILED", error: explain(e), title: (await prisma.contentItem.findUnique({ where: { id } }))?.title.replace(" (yazılıyor…)", "") },
    });
    await log(`Bölüm yazılamadı: ${explain(e)}`, { itemId: id, level: "error" });
  }
}

/**
 * Panelden "Devam et": son bölümün devamını kullanıcının seçtiği (A/B) ya da yazdığı yönde hemen yazar ve üretir.
 * İsteğe bağlı olarak yeni bölümün A/B seçenekleri de kullanıcıdan gelir.
 */
export async function continueEpisode(
  fromId: string,
  opts: { choice: "A" | "B" | "custom"; text: string; nextA?: string; nextB?: string; publishNow: boolean; note?: string },
) {
  const from = await prisma.contentItem.findUniqueOrThrow({ where: { id: fromId } });
  if (from.episodeNumber == null || !from.channelId) throw new Error("Bu video bir hikâye bölümü değil");
  const newer = await prisma.contentItem.findFirst({
    where: { channelId: from.channelId, episodeNumber: { gt: from.episodeNumber } },
    orderBy: { episodeNumber: "asc" },
  });
  if (newer) return newer.id; // devamı zaten var
  const text =
    opts.choice === "A" ? from.choiceA ?? "" : opts.choice === "B" ? from.choiceB ?? "" : opts.text.trim();
  if (!text) throw new Error("Devam için bir seçenek seçin veya yazın");
  if (!from.summary) await prisma.contentItem.update({ where: { id: fromId }, data: { summary: from.script.slice(0, 600) } });
  const label = opts.choice === "custom" ? "Özel" : opts.choice;
  const nextChoices = opts.nextA?.trim() && opts.nextB?.trim() ? { a: opts.nextA.trim(), b: opts.nextB.trim() } : undefined;
  const id = await startEpisode(from.channelId, { publishAt: new Date(), autoUpload: opts.publishNow, topicHint: opts.note });
  // Seçim kayda geçsin: yazım hata verirse "Bölümü yeniden yaz" aynı seçimle tekrar dener
  await prisma.contentItem.update({
    where: { id },
    data: { chosen: `${label}: ${text}`, ...(nextChoices ? { choiceA: nextChoices.a, choiceB: nextChoices.b } : {}) },
  });
  void (async () => {
    await finishEpisode(id, opts.note ?? "", { chosen: label, text, nextChoices });
    const it = await prisma.contentItem.findUnique({ where: { id } });
    if (it?.status !== "APPROVED") return;
    await produceItem(id);
    if (opts.publishNow) await publishItem(id, { force: true });
  })();
  return id;
}

/** Metni yazılamamış (hatalı) bölümü, varsa kayıtlı elle seçimle yeniden yazar ve üretir */
export async function retryEpisode(id: string) {
  const it = await prisma.contentItem.findUniqueOrThrow({ where: { id } });
  if (it.episodeNumber == null || it.script.trim()) return;
  await prisma.contentItem.update({ where: { id }, data: { status: "WRITING", error: null, title: `Bölüm ${it.episodeNumber} (yazılıyor…)` } });
  const m = it.chosen?.match(/^([^:]+):\s*([\s\S]+)$/);
  const override = m
    ? { chosen: m[1], text: m[2], nextChoices: it.choiceA && it.choiceB ? { a: it.choiceA, b: it.choiceB } : undefined }
    : undefined;
  void (async () => {
    await finishEpisode(id, "", override);
    const done = await prisma.contentItem.findUnique({ where: { id } });
    if (done?.status !== "APPROVED") return;
    await produceItem(id);
    if (done.autoUpload) await publishItem(id, { force: true });
  })();
}

/**
 * Otomatik mod: sıradaki yayın saatine `produceHoursAhead` saat kala bir sonraki bölümü yazar.
 * Önceki bölüm yayınlanmadan yenisi yazılmaz (oyların toplanabilmesi için).
 */
async function ensureNextEpisode(channelId: string) {
  const s = await channelSettings(channelId);
  const tz = s.timezone;
  const pending = await prisma.contentItem.count({
    where: { channelId, episodeNumber: { not: null }, status: { in: ["WRITING", "DRAFT", "APPROVED", "PRODUCING", "READY", "UPLOADING"] } },
  });
  if (pending > 0) return;
  const last = await prisma.contentItem.findFirst({ where: { channelId, episodeNumber: { not: null } }, orderBy: { episodeNumber: "desc" } });
  if (last?.status === "FAILED") return; // hata çözülene kadar bekle
  if (last && last.publishAt.getTime() > Date.now()) return; // önceki bölüm henüz yayında değil

  const now = Date.now();
  const times = parsePublishTimes(s.publishTimes).slice(0, Math.max(1, s.videosPerDay));
  const today = ymdInTz(new Date(), tz);
  let next: Date | null = null;
  for (let d = 0; d < 3 && !next; d++) {
    for (const t of times) {
      const at = zonedToUtc(addDaysYmd(today, d), t, tz);
      if (at.getTime() > now + 30 * 60_000) {
        next = at;
        break;
      }
    }
  }
  if (!next || next.getTime() - now > s.produceHoursAhead * 3600_000) return;
  const id = await startEpisode(channelId, { publishAt: next, autoUpload: true });
  await finishEpisode(id);
}
