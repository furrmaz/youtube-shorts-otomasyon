import type { Channel } from "@prisma/client";
import { prisma } from "./db";
import { getSettings, type AppSettings } from "./settings";
import type { StyleProfileT } from "./claude";
import { lookOf, type Look } from "./look";

export function parseStyle(c: Pick<Channel, "styleProfile">): StyleProfileT | null {
  try {
    return c.styleProfile ? (JSON.parse(c.styleProfile) as StyleProfileT) : null;
  } catch {
    return null;
  }
}

/** Eskiden genel ayarlarda olan, artık her kanala özel alanlar */
export const CHANNEL_FIELDS = [
  "niche", "language", "channelStyle", "visualStyle", "elevenVoiceId", "videosPerDay", "publishTimes",
  "privacyStatus", "autoProduce", "contentFormat", "seriesTitle", "seriesPremise", "seriesCharacters",
  "storyMinutes", "subtitleStyle", "watermark", "musicPrompt",
] as const;

/** Kanal içerikleri için birleşik ayarlar: genel ayarlar (anahtarlar, efektler) + kanalın kendi alanları */
export type ChannelSettings = AppSettings & { channel: Channel; styleGuide: StyleProfileT | null; look: Look };

export const BRAND_VISUAL_STYLE = (c: Pick<Channel, "primaryColor" | "accentColor">, palette: string[] = []) =>
  palette.length > 2
    ? `clean minimalist flat 2D vector illustration, bold simple shapes, limited color palette ${palette.join(", ")} with white highlights, soft shadows, editorial poster look, rounded geometric shapes, no readable text`
    : `clean minimalist flat 2D vector motion-graphics illustration, modern tech product explainer look, simple stylized people with large round heads and dot eyes, dark navy background (#0b1020 to #141b2d) with brand accent colors ${c.primaryColor} and ${c.accentColor}, soft glows on screens and key objects, rounded geometric shapes, clean UI cards and icons without readable text`;

let ensured = false;
/**
 * İlk çalıştırmada eski tek kanallı kurulumu "ana kanal"a taşır:
 * genel ayarlardaki içerik alanları, mevcut videolar ve bağlı YouTube hesabı.
 */
export async function ensureChannels() {
  if (ensured) return;
  const count = await prisma.channel.count();
  if (count === 0) {
    const s = await getSettings();
    const data: Record<string, unknown> = {};
    for (const f of CHANNEL_FIELDS) data[f] = s[f];
    const ch = await prisma.channel.create({
      data: { ...(data as object), name: s.seriesTitle || s.niche || "Ana kanal" } as Parameters<typeof prisma.channel.create>[0]["data"],
    });
    await prisma.contentItem.updateMany({ where: { channelId: null }, data: { channelId: ch.id } });
    const yt = await prisma.youtubeAccount.findUnique({ where: { id: 1 } });
    if (yt) {
      await prisma.connection.create({
        data: {
          channelId: ch.id, platform: "youtube", accountId: yt.channelId, accountName: yt.channelTitle,
          accessToken: yt.accessToken, refreshToken: yt.refreshToken, expiresAt: yt.expiryDate,
        },
      });
    }
  } else {
    // Kanalı olmayan eski kayıtlar varsa ilk kanala bağla
    const first = await prisma.channel.findFirst({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    if (first) await prisma.contentItem.updateMany({ where: { channelId: null }, data: { channelId: first.id } });
  }
  ensured = true;
}

export async function listChannels() {
  await ensureChannels();
  return prisma.channel.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
}

export async function channelSettings(channelId: string | null | undefined): Promise<ChannelSettings> {
  await ensureChannels();
  const s = await getSettings();
  const channel =
    (channelId && (await prisma.channel.findUnique({ where: { id: channelId } }))) ||
    (await prisma.channel.findFirstOrThrow({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }));
  const look = lookOf(channel);
  const merged = { ...s, channel, look, styleGuide: channel.styleOn ? parseStyle(channel) : null } as ChannelSettings;
  for (const f of CHANNEL_FIELDS) (merged as Record<string, unknown>)[f] = channel[f];
  if (!merged.visualStyle.trim()) merged.visualStyle = BRAND_VISUAL_STYLE(channel, look.custom ? look.palette : []);
  if (!merged.niche.trim() && channel.productName) merged.niche = `${channel.productName}: ${channel.productProblem}`;
  return merged;
}

