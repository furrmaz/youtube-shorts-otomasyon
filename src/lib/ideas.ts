// İzleyici istekleri: yorumlarda "şunu da anlatın" denen konular toplanır, sayılır ve
// takvim yazılırken önce bunlar kullanılır. Örnek videodaki kapanış cümlesi ("Merak ettiğin efsaneyi
// yoruma yaz, serinin diğer videosunda onu anlatalım") ile birlikte kanal kendi konularını üretir.
import { prisma } from "./db";
import { log } from "./log";
import { channelSettings } from "./channels";
import { extractTopicRequests } from "./claude";
import { recentComments } from "./youtube";
import { words } from "./originality";

/** Karşılaştırma anahtarı: anlamlı kelimelerin ilk 5 harfi, sıralı (Türkçe ekler ve yazım farkları için) */
export function ideaKey(topic: string): string {
  // "Alex'i", "Hagi'yi" gibi kesme işaretinden sonraki ekler atılır
  const base = topic.replace(/['’`]\p{L}+/gu, "");
  return [...new Set(words(base).filter((w) => w.length > 2).map((w) => w.slice(0, 5)))].sort().join(" ");
}

/** Konu kanalda zaten işlenmiş mi: anahtar kelimelerin tamamı bir videonun konu/başlığında geçiyor */
function alreadyMade(key: string, made: { id: string; keys: Set<string> }[]) {
  const ks = key.split(" ").filter(Boolean);
  if (!ks.length) return null;
  return made.find((m) => ks.every((k) => m.keys.has(k)))?.id ?? null;
}

async function madeIndex(channelId: string) {
  const items = await prisma.contentItem.findMany({ where: { channelId }, select: { id: true, topic: true, title: true } });
  return items.map((i) => ({ id: i.id, keys: new Set(ideaKey(`${i.topic} ${i.title}`).split(" ")) }));
}

/** Son 30 günde yüklenen videoların yeni yorumlarını okur ve konu isteklerini kaydeder */
export async function scanIdeas(channelId: string): Promise<{ comments: number; added: number; bumped: number }> {
  const ch = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
  const startedAt = new Date();
  const vids = await prisma.contentItem.findMany({
    where: { channelId, youtubeVideoId: { not: null }, publishAt: { gte: new Date(Date.now() - 30 * 86400_000), lte: new Date() } },
    orderBy: { publishAt: "desc" },
    select: { youtubeVideoId: true },
    take: 40,
  });
  let added = 0;
  let bumped = 0;
  let total = 0;
  if (vids.length) {
    const comments = await recentComments(channelId, vids.map((v) => v.youtubeVideoId!), ch.ideasScanAt);
    total = comments.length;
    if (comments.length) {
      const s = await channelSettings(channelId);
      const made = await madeIndex(channelId);
      // Claude'a tek seferde en fazla 400 yorum
      for (let i = 0; i < comments.length; i += 400) {
        const reqs = await extractTopicRequests(s, comments.slice(i, i + 400).map((c) => c.text));
        for (const r of reqs) {
          const topic = r.topic.trim().slice(0, 120);
          const key = ideaKey(topic);
          if (!key) continue;
          const count = Math.max(1, Math.round(r.count) || 1);
          const prev = await prisma.topicIdea.findUnique({ where: { channelId_key: { channelId, key } } });
          if (prev) {
            await prisma.topicIdea.update({ where: { id: prev.id }, data: { count: prev.count + count, example: prev.example || r.example.slice(0, 200) } });
            bumped++;
          } else {
            const doneId = alreadyMade(key, made);
            await prisma.topicIdea.create({
              data: {
                channelId, topic, key, count, example: r.example.slice(0, 200),
                // Videosu zaten olan konular "kullanıldı" olarak gelir; listede yine sayısı görünür
                ...(doneId ? { status: "used", itemId: doneId } : {}),
              },
            });
            added++;
          }
        }
      }
    }
  }
  await prisma.channel.update({ where: { id: channelId }, data: { ideasScanAt: startedAt } });
  if (added || bumped) await log(`[${ch.name}] Yorumlardan ${added} yeni konu isteği, ${bumped} tekrar (${total} yorum)`);
  return { comments: total, added, bumped };
}

/** Takvim istemine eklenen "izleyici istekleri" bölümü ve kullanılan isteklerin kimlikleri */
export async function ideaBrief(channelId: string, slots: number): Promise<{ text: string; ids: string[] }> {
  const ideas = await prisma.topicIdea.findMany({
    where: { channelId, status: "new" },
    orderBy: [{ count: "desc" }, { createdAt: "asc" }],
    take: Math.min(15, Math.max(1, Math.ceil(slots / 2))),
  });
  if (!ideas.length) return { text: "", ids: [] };
  const lines = ideas.map((i) => `- ${i.topic}${i.count > 1 ? ` (${i.count} yorumda istendi)` : ""}`).join("\n");
  return {
    text: `\n\nİZLEYİCİ İSTEKLERİ (yorumlarda en çok istenenler; önce bunları işle, her biri ayrı bir video olsun):\n${lines}`,
    ids: ideas.map((i) => i.id),
  };
}

export async function markIdeasUsed(ids: string[]) {
  if (ids.length) await prisma.topicIdea.updateMany({ where: { id: { in: ids } }, data: { status: "used" } });
}
