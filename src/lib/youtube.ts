import fs from "node:fs";
import { google } from "googleapis";
import { prisma } from "./db";
import { cfg } from "./config";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

export async function oauthClient() {
  const c = await cfg();
  if (!c.googleClientId || !c.googleClientSecret)
    throw new Error("Google OAuth bilgileri girilmemiş (Ayarlar → API anahtarları)");
  return new google.auth.OAuth2(c.googleClientId, c.googleClientSecret, `${c.appUrl}/api/youtube/callback`);
}

export async function authUrl(state: string) {
  return (await oauthClient()).generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, state });
}

export async function handleCallback(code: string) {
  const client = await oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const yt = google.youtube({ version: "v3", auth: client });
  const ch = await yt.channels.list({ part: ["snippet"], mine: true });
  const channel = ch.data.items?.[0];
  if (!channel?.id) throw new Error("Bu Google hesabında YouTube kanalı bulunamadı");
  const existing = await prisma.youtubeAccount.findUnique({ where: { id: 1 } });
  const refresh = tokens.refresh_token ?? existing?.refreshToken;
  if (!refresh) throw new Error("Refresh token alınamadı; Google hesabından uygulama erişimini kaldırıp tekrar bağlayın");
  const data = {
    channelId: channel.id,
    channelTitle: channel.snippet?.title ?? "",
    accessToken: tokens.access_token ?? "",
    refreshToken: refresh,
    expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  };
  await prisma.youtubeAccount.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  return data.channelTitle;
}

async function authedClient() {
  const acc = await prisma.youtubeAccount.findUnique({ where: { id: 1 } });
  if (!acc) throw new Error("YouTube kanalı bağlı değil");
  const client = await oauthClient();
  client.setCredentials({
    access_token: acc.accessToken,
    refresh_token: acc.refreshToken,
    expiry_date: acc.expiryDate?.getTime(),
  });
  client.on("tokens", async (t) => {
    await prisma.youtubeAccount.update({
      where: { id: 1 },
      data: {
        accessToken: t.access_token ?? acc.accessToken,
        ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
        ...(t.expiry_date ? { expiryDate: new Date(t.expiry_date) } : {}),
      },
    });
  });
  return client;
}

export async function uploadShort(opts: {
  filePath: string;
  title: string;
  description: string;
  tags: string[];
  language: string;
  privacyStatus: string;
  publishAt?: Date;
}): Promise<string> {
  const auth = await authedClient();
  const yt = google.youtube({ version: "v3", auth });
  const title = (opts.title.includes("#Shorts") ? opts.title : `${opts.title} #Shorts`).slice(0, 100);
  const description = opts.description.includes("#Shorts") ? opts.description : `${opts.description}\n\n#Shorts`;
  // İleri tarihli yayın: YouTube 'private' + publishAt ile kendisi yayınlar
  const scheduled = opts.publishAt && opts.publishAt.getTime() > Date.now() + 15 * 60_000;
  const res = await yt.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title,
        description: description.slice(0, 4900),
        tags: opts.tags.slice(0, 30),
        categoryId: "27", // Eğitim
        defaultLanguage: opts.language,
        defaultAudioLanguage: opts.language,
      },
      status: {
        privacyStatus: scheduled ? "private" : opts.privacyStatus,
        ...(scheduled ? { publishAt: opts.publishAt!.toISOString() } : {}),
        selfDeclaredMadeForKids: false,
        // YouTube "değiştirilmiş/sentetik içerik" beyanı (yapay zekâ görselleri ve ses)
        containsSyntheticMedia: true,
      } as Record<string, unknown>,
    },
    media: { mimeType: "video/mp4", body: fs.createReadStream(opts.filePath) },
  });
  if (!res.data.id) throw new Error("YouTube video ID döndürmedi");
  return res.data.id;
}

/** Bölüm yorumlarındaki A/B oylarını sayar (her yorumcu bir kez) */
export async function countVotes(videoId: string): Promise<{ a: number; b: number }> {
  const auth = await authedClient();
  const yt = google.youtube({ version: "v3", auth });
  const voters = new Map<string, "A" | "B">();
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await yt.commentThreads.list({
      part: ["snippet"], videoId, maxResults: 100, pageToken, textFormat: "plainText",
    });
    for (const t of res.data.items ?? []) {
      const c = t.snippet?.topLevelComment?.snippet;
      const text = (c?.textOriginal ?? c?.textDisplay ?? "").trim();
      // "A", "a!", "A şıkkı", "Bence B" gibi yorumlar; ikisini birden içerenler sayılmaz
      const hasA = /(^|[^\p{L}])a([^\p{L}]|$)/iu.test(text);
      const hasB = /(^|[^\p{L}])b([^\p{L}]|$)/iu.test(text);
      if (hasA === hasB) continue;
      const who = c?.authorChannelId?.value ?? c?.authorDisplayName ?? Math.random().toString();
      voters.set(who, hasA ? "A" : "B");
    }
    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }
  let a = 0;
  let b = 0;
  for (const v of voters.values()) v === "A" ? a++ : b++;
  return { a, b };
}

export type VideoStats = { views: number; likes: number; comments: number };

/** Yüklenen videoların izlenme/beğeni/yorum sayıları (50'şerli gruplar halinde) */
export async function fetchStats(videoIds: string[]): Promise<Map<string, VideoStats>> {
  const auth = await authedClient();
  const yt = google.youtube({ version: "v3", auth });
  const out = new Map<string, VideoStats>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const res = await yt.videos.list({ part: ["statistics"], id: videoIds.slice(i, i + 50), maxResults: 50 });
    for (const v of res.data.items ?? []) {
      if (!v.id) continue;
      out.set(v.id, {
        views: Number(v.statistics?.viewCount ?? 0),
        likes: Number(v.statistics?.likeCount ?? 0),
        comments: Number(v.statistics?.commentCount ?? 0),
      });
    }
  }
  return out;
}
