"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import fs from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { createQuickVideo, createSalesVideos, generateCalendar, produceItem, refreshStats, uploadItem } from "@/lib/pipeline";
import { ensureChannels } from "@/lib/channels";
import { BEFWARE_PRESETS } from "@/lib/presets";
import { CHANNEL_COOKIE, currentChannel } from "@/lib/current-channel";
import { tiktokConnect } from "@/lib/tiktok";
import { instagramConnect } from "@/lib/instagram";
import { svgToPng } from "@/lib/images";
import { ffmpeg } from "@/lib/ffmpeg";
import { requireAuth, setAuthCookie } from "@/lib/auth";
import { cfg } from "@/lib/config";
import { testClaude, STORY_VISUAL_STYLE } from "@/lib/claude";
import { itemDir, MEDIA_DIR } from "@/lib/paths";
import { getSettings } from "@/lib/settings";
import { zonedToUtc } from "@/lib/time";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveSettings(f: FormData) {
  await requireAuth();
  const data = {
    timezone: str(f, "timezone") || "Europe/Istanbul",
    imageProvider: str(f, "imageProvider") || "mock",
    ttsProvider: str(f, "ttsProvider") || "mock",
    produceHoursAhead: Math.max(1, Number(str(f, "produceHoursAhead")) || 6),
    musicVolume: Math.min(1, Math.max(0, Number(str(f, "musicVolume").replace(",", ".")) || 0)),
    musicSource: ["off", "folder", "eleven"].includes(str(f, "musicSource")) ? str(f, "musicSource") : "folder",
    sfx: f.get("sfx") === "on",
    particles: f.get("particles") === "on",
    progressBar: f.get("progressBar") === "on",
    hookText: f.get("hookText") === "on",
  };
  await prisma.settings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  revalidatePath("/", "layout");
  redirect("/settings?saved=1");
}

// ---------------- Kanallar ----------------

const FORMATS = ["info", "story", "promo"];

export async function selectChannel(f: FormData) {
  await requireAuth();
  const id = str(f, "channel");
  (await cookies()).set(CHANNEL_COOKIE, id, { httpOnly: true, sameSite: "lax", maxAge: 365 * 86400, path: "/" });
  const back = str(f, "back");
  revalidatePath("/", "layout");
  redirect(back.startsWith("/") && !back.startsWith("/channels/") ? back : "/");
}

export async function createChannel(f: FormData) {
  await requireAuth();
  const format = FORMATS.includes(str(f, "contentFormat")) ? str(f, "contentFormat") : "info";
  const ch = await prisma.channel.create({
    data: {
      name: str(f, "name") || "Yeni kanal",
      contentFormat: format,
      language: (await currentChannel()).language || "tr",
      subtitleStyle: format === "story" ? "minimal" : "karaoke",
      visualStyle: format === "story" ? STORY_VISUAL_STYLE : "",
      autoProduce: false,
      sortOrder: await prisma.channel.count(),
    },
  });
  (await cookies()).set(CHANNEL_COOKIE, ch.id, { httpOnly: true, sameSite: "lax", maxAge: 365 * 86400, path: "/" });
  revalidatePath("/", "layout");
  redirect(`/channels/${ch.id}?new=1`);
}

export async function deleteChannel(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  if ((await prisma.channel.count()) <= 1) redirect(`/channels/${id}?msg=${encodeURIComponent("Son kanal silinemez")}`);
  const items = await prisma.contentItem.findMany({ where: { channelId: id }, select: { id: true } });
  await prisma.channel.delete({ where: { id } });
  await Promise.all(items.map((it) => clearMedia(it.id)));
  await fs.rm(path.join(MEDIA_DIR, "brand", `${id}.png`), { force: true });
  (await cookies()).delete(CHANNEL_COOKIE);
  revalidatePath("/", "layout");
  redirect("/channels");
}

export async function saveChannel(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  const prev = await prisma.channel.findUniqueOrThrow({ where: { id } });
  const format = FORMATS.includes(str(f, "contentFormat")) ? str(f, "contentFormat") : "info";
  const hex = (k: string, d: string) => (/^#[0-9a-f]{6}$/i.test(str(f, k)) ? str(f, k) : d);
  const data = {
    name: str(f, "name") || prev.name,
    contentFormat: format,
    niche: str(f, "niche"),
    language: str(f, "language") || "tr",
    channelStyle: str(f, "channelStyle"),
    visualStyle: str(f, "visualStyle"),
    elevenVoiceId: str(f, "elevenVoiceId").startsWith("sk_") ? "" : str(f, "elevenVoiceId"),
    videosPerDay: Math.min(5, Math.max(1, Number(str(f, "videosPerDay")) || 1)),
    publishTimes: str(f, "publishTimes") || "18:00",
    privacyStatus: str(f, "privacyStatus") || "public",
    autoProduce: f.get("autoProduce") === "on",
    subtitleStyle: ["karaoke", "minimal", "off"].includes(str(f, "subtitleStyle")) ? str(f, "subtitleStyle") : "karaoke",
    watermark: str(f, "watermark"),
    musicPrompt: str(f, "musicPrompt"),
    seriesTitle: str(f, "seriesTitle"),
    seriesPremise: str(f, "seriesPremise"),
    seriesCharacters: str(f, "seriesCharacters"),
    storyMinutes: Math.min(2.8, Math.max(1, Number(str(f, "storyMinutes").replace(",", ".")) || 2.5)),
    productName: str(f, "productName"),
    productUrl: str(f, "productUrl"),
    productProblem: str(f, "productProblem"),
    productFeatures: str(f, "productFeatures"),
    targetAudience: str(f, "targetAudience"),
    cta: str(f, "cta"),
    sectors: str(f, "sectors"),
    primaryColor: hex("primaryColor", prev.primaryColor),
    accentColor: hex("accentColor", prev.accentColor),
    toYoutube: f.get("toYoutube") === "on",
    toTiktok: f.get("toTiktok") === "on",
    toInstagram: f.get("toInstagram") === "on",
    tiktokMode: str(f, "tiktokMode") === "direct" ? "direct" : "draft",
    logoPath: f.get("clearLogo") === "on" ? "" : prev.logoPath,
  };
  // Hikâye moduna ilk geçişte örnek videodaki görsel dili ve sade altyazıyı varsayılan yap
  if (format === "story" && prev.contentFormat !== "story") {
    if (!data.visualStyle || data.visualStyle.startsWith("flat 2D hand-drawn illustration")) data.visualStyle = STORY_VISUAL_STYLE;
    if (data.subtitleStyle === "karaoke") data.subtitleStyle = "minimal";
  }
  const logo = f.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const dir = path.join(MEDIA_DIR, "brand");
    await fs.mkdir(dir, { recursive: true });
    const out = path.join(dir, `${id}.png`);
    const tmp = path.join(dir, `${id}_upload${path.extname(logo.name) || ".png"}`);
    await fs.writeFile(tmp, Buffer.from(await logo.arrayBuffer()));
    // Her biçimi (jpg, webp, svg…) kare olmayan oranı koruyarak PNG'ye çevir
    try {
      if (tmp.endsWith(".svg")) await svgToPng(await fs.readFile(tmp, "utf8"), out, 512, true);
      else await ffmpeg(["-i", tmp, "-vf", "scale='min(512,iw)':-2", "-frames:v", "1", out]);
      data.logoPath = out;
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
  await prisma.channel.update({ where: { id }, data });
  revalidatePath("/", "layout");
  redirect(`/channels/${id}?saved=1`);
}

const back = (id: string, k: string, v: string) => `/channels/${id}?${k}=${encodeURIComponent(v)}#baglantilar`;

export async function connectTiktok(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  let to: string;
  try {
    to = back(id, "ok", `TikTok bağlandı: ${await tiktokConnect(id, str(f, "code"))}`);
  } catch (e) {
    to = back(id, "msg", (e as Error).message);
  }
  redirect(to);
}

export async function connectInstagram(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  let to: string;
  try {
    to = back(id, "ok", `Instagram bağlandı: @${await instagramConnect(id, str(f, "token"), str(f, "username"))}`);
  } catch (e) {
    to = back(id, "msg", (e as Error).message);
  }
  redirect(to);
}

export async function disconnectPlatform(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  await prisma.connection.deleteMany({ where: { channelId: id, platform: str(f, "platform") } });
  revalidatePath("/", "layout");
  redirect(`/channels/${id}#baglantilar`);
}

/** PDF'teki Befware ürünleri için hazır kanal profilleri (zaten varsa atlanır) */
export async function seedBefwareChannels() {
  await requireAuth();
  await ensureChannels();
  for (const p of BEFWARE_PRESETS) {
    if (await prisma.channel.findFirst({ where: { productName: p.productName } })) continue;
    await prisma.channel.create({ data: { ...p, sortOrder: await prisma.channel.count() } });
  }
  revalidatePath("/", "layout");
  redirect("/channels?seeded=1");
}

/** Satış ekibi için sektör sektör kısa videolar */
export async function makeSalesVideos(f: FormData) {
  await requireAuth();
  const ch = await currentChannel();
  const sectors = str(f, "sectors").split(/[,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 12);
  if (sectors.length) void createSalesVideos(ch.id, sectors).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  revalidatePath("/sales");
  redirect("/sales?started=1");
}

export async function startCalendar(f: FormData) {
  await requireAuth();
  const days = Math.min(60, Math.max(1, Number(str(f, "days")) || 30));
  const ch = await currentChannel();
  // Uzun sürer (birkaç dakika): arka planda çalıştır, sayfa durumu gösterir
  void generateCalendar(ch.id, days);
  await new Promise((r) => setTimeout(r, 300));
  revalidatePath("/calendar");
}

export async function saveItem(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  const tags = str(f, "tags").split(",").map((t) => t.trim()).filter(Boolean);
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id } });
  const scriptChanged = item.script !== str(f, "script");
  await prisma.contentItem.update({
    where: { id },
    data: {
      topic: str(f, "topic"),
      hook: str(f, "hook"),
      script: str(f, "script"),
      title: str(f, "title"),
      description: str(f, "description"),
      tags: JSON.stringify(tags),
      ...(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str(f, "publishAt"))
        ? { publishAt: zonedToUtc(str(f, "publishAt").slice(0, 10), str(f, "publishAt").slice(11, 16), (await getSettings()).timezone) }
        : {}),
      // Metin değiştiyse eski ses/sahne planı geçersiz
      ...(scriptChanged ? { scenes: null, status: item.status === "UPLOADED" ? item.status : "DRAFT" } : {}),
    },
  });
  if (scriptChanged) await clearMedia(id);
  revalidatePath("/calendar");
  revalidatePath(`/items/${id}`);
}

async function clearMedia(id: string) {
  const dir = await itemDir(id);
  await fs.rm(dir, { recursive: true, force: true });
}

export async function setStatus(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  const status = str(f, "status");
  if (!["DRAFT", "APPROVED"].includes(status)) return;
  await prisma.contentItem.updateMany({
    where: { id, status: { in: ["DRAFT", "APPROVED", "FAILED"] } },
    data: { status, error: null },
  });
  revalidatePath("/calendar");
  revalidatePath(`/items/${id}`);
}

export async function approveAll() {
  await requireAuth();
  const ch = await currentChannel();
  await prisma.contentItem.updateMany({ where: { status: "DRAFT", channelId: ch.id }, data: { status: "APPROVED" } });
  revalidatePath("/calendar");
}

export async function deleteItem(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  await prisma.contentItem.deleteMany({ where: { id, status: { not: "UPLOADED" } } });
  await clearMedia(id);
  revalidatePath("/calendar");
}

export async function produceNow(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  await prisma.contentItem.updateMany({ where: { id, status: "DRAFT" }, data: { status: "APPROVED" } });
  void produceItem(id);
  await new Promise((r) => setTimeout(r, 300));
  revalidatePath(`/items/${id}`);
}

export async function regenerateMedia(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  await clearMedia(id);
  await prisma.contentItem.updateMany({
    where: { id, status: { in: ["READY", "FAILED"] } },
    data: { scenes: null, videoPath: null, audioPath: null, status: "APPROVED", error: null },
  });
  void produceItem(id);
  await new Promise((r) => setTimeout(r, 300));
  revalidatePath(`/items/${id}`);
}

/** Tek bir sahnenin görselini (isteğe bağlı yeni tarifle) yeniden üretir, ses ve diğer sahneler korunur */
export async function redrawScene(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  const idx = Number(str(f, "idx"));
  const prompt = str(f, "prompt");
  const it = await prisma.contentItem.findUnique({ where: { id } });
  if (!it?.scenes || !["READY", "FAILED"].includes(it.status)) return;
  const scenes = JSON.parse(it.scenes) as { imagePrompt: string; image?: string }[];
  const sc = scenes[idx];
  if (!sc) return;
  if (prompt) sc.imagePrompt = prompt;
  if (sc.image) {
    const base = sc.image.replace(/\.png$/, "");
    await Promise.all(
      [".png", ".svg", "_bg.png", "_mid.png", "_fg.png"].map((ext) => fs.rm(base + ext, { force: true })),
    );
  }
  await prisma.contentItem.update({ where: { id }, data: { scenes: JSON.stringify(scenes), error: null } });
  void produceItem(id);
  await new Promise((r) => setTimeout(r, 300));
  revalidatePath(`/items/${id}`);
}

/** Ses ve görselleri koruyup yalnızca montajı güncel ayarlarla (müzik, efektler, altyazı) yeniden yapar */
export async function rerenderVideo(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  void produceItem(id);
  await new Promise((r) => setTimeout(r, 300));
  revalidatePath(`/items/${id}`);
}

export async function uploadNow(f: FormData) {
  await requireAuth();
  const id = str(f, "id");
  await prisma.contentItem.updateMany({ where: { id, status: "READY" }, data: { error: null } });
  void uploadItem(id);
  await new Promise((r) => setTimeout(r, 300));
  revalidatePath(`/items/${id}`);
}

export async function disconnectYoutube() {
  await requireAuth();
  const ch = await currentChannel();
  await prisma.connection.deleteMany({ where: { channelId: ch.id, platform: "youtube" } });
  await prisma.youtubeAccount.deleteMany({});
  revalidatePath("/", "layout");
}

const SECRET_FIELDS = [
  "anthropicApiKey", "elevenApiKey", "falKey", "replicateToken", "googleClientSecret", "panelPassword",
  "tiktokClientSecret", "metaAppSecret",
] as const;
const PLAIN_FIELDS = [
  "claudeModel", "elevenModelId", "falModel", "replicateModel", "googleClientId", "appUrl",
  "tiktokClientKey", "tiktokRedirectUri", "metaAppId",
] as const;

/** API anahtarları: boş bırakılan gizli alan mevcut değeri korur, "kaldır" işaretliyse silinir */
export async function saveKeys(f: FormData) {
  await requireAuth();
  const data: Record<string, string> = {};
  for (const k of SECRET_FIELDS) {
    if (f.get(`clear_${k}`) === "on") data[k] = "";
    else if (str(f, k)) data[k] = str(f, k);
  }
  for (const k of PLAIN_FIELDS) data[k] = str(f, k);
  await prisma.settings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  // Şifre değiştiyse bu tarayıcıda oturum açık kalsın
  const { panelPassword } = await cfg();
  if (panelPassword) await setAuthCookie(panelPassword);
  revalidatePath("/", "layout");
  redirect("/settings?saved=keys#anahtarlar");
}

export async function testKeys() {
  await requireAuth();
  const c = await cfg();
  const results: Record<string, string> = {};
  const check = async (name: string, fn: () => Promise<string>) => {
    try {
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("zaman aşımı (20 sn)")), 20_000));
      results[name] = "✓ " + (await Promise.race([fn(), timeout]));
    } catch (e) {
      const msg = (e as Error).message;
      results[name] = "✗ " + (/^401\b|HTTP 401/.test(msg) ? "anahtar geçersiz (401)" : msg.slice(0, 160));
    }
  };
  await Promise.all([
    check("Claude", testClaude),
    check("ElevenLabs", async () => {
      if (!c.elevenApiKey) throw new Error("anahtar girilmemiş");
      const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": c.elevenApiKey } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as { character_count?: number; character_limit?: number; tier?: string };
      return `bağlandı (${d.tier ?? ""}, ${d.character_count ?? "?"}/${d.character_limit ?? "?"} karakter)`;
    }),
    check("Replicate", async () => {
      if (!c.replicateToken) throw new Error("anahtar girilmemiş");
      const r = await fetch("https://api.replicate.com/v1/account", { headers: { Authorization: `Bearer ${c.replicateToken}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "bağlandı";
    }),
    check("fal.ai", async () => {
      if (!c.falKey) throw new Error("anahtar girilmemiş");
      return "girildi (ilk görselde doğrulanır)";
    }),
    check("Google", async () => {
      if (!c.googleClientId || !c.googleClientSecret) throw new Error("Client ID / Secret girilmemiş");
      return "girildi, panelden kanalı bağlayın";
    }),
  ]);
  redirect(`/settings?test=${encodeURIComponent(JSON.stringify(results))}#anahtarlar`);
}

/** İstenildiği anda yeni video */
export async function quickVideo(f: FormData) {
  await requireAuth();
  const ch = await currentChannel();
  const id = await createQuickVideo(ch.id, { topicHint: str(f, "topic"), publishNow: str(f, "mode") === "publish" });
  redirect(`/items/${id}`);
}

export async function refreshStatsNow() {
  await requireAuth();
  await refreshStats(true, (await currentChannel()).id);
  revalidatePath("/");
}
