// Özgünlük denetimi: YouTube'un "tekrarlayan / yeniden kullanılan içerik" politikasına takılmamak için
// yeni metinleri kanalın önceki videolarıyla karşılaştırır. Tamamen yerel çalışır (API çağrısı yok).
import { prisma } from "./db";

// Benzerlik eşikleri: bunların üstü "neredeyse aynı video" sayılır
export const SCRIPT_LIMIT = 0.3; // metin: 3 kelimelik dizilerin örtüşmesi (Jaccard)
export const TITLE_LIMIT = 0.75; // başlık: anlamlı kelimelerin örtüşmesi
export const HOOK_LIMIT = 0.6; // kanca cümlesi

const STOP = new Set(
  (
    "ve ile bir bu şu o da de mi mı mu mü ne için gibi daha en çok ama ya hem ki kadar sonra önce her hiç " +
    "the a an and or of to in on for is are was it this that with you your how why what"
  ).split(" "),
);

export function words(text: string): string[] {
  return (text || "")
    .toLocaleLowerCase("tr")
    .replace(/#\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function shingles(w: string[], n: number): Set<string> {
  const out = new Set<string>();
  if (w.length < n) {
    if (w.length) out.add(w.join(" "));
    return out;
  }
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Türkçe ekler yüzünden (ahtapotun / ahtapotların) kelime kökü olarak ilk 5 harf alınır
const keyWords = (t: string) => new Set(words(t).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5)));

export type Comparable = { id?: string; title: string; hook?: string; script?: string };
export type Match = {
  id?: string;
  title: string;
  field: "metin" | "başlık" | "kanca";
  /** gerçek örtüşme oranı (0-1) */
  raw: number;
  /** eşiğe göre oran: 1 ve üstü = tekrar sayılır */
  score: number;
};

/** İki içerik arasındaki en yüksek benzerlik (eşik oranına göre normalize: 1 = sınırda) */
export function compare(a: Comparable, b: Comparable): Match | null {
  const res: Match[] = [];
  const sa = words(a.script ?? "");
  const sb = words(b.script ?? "");
  const add = (field: Match["field"], raw: number, limit: number) => res.push({ title: b.title, id: b.id, field, raw, score: raw / limit });
  if (sa.length >= 25 && sb.length >= 25) add("metin", jaccard(shingles(sa, 3), shingles(sb, 3)), SCRIPT_LIMIT);
  if (a.title && b.title) add("başlık", jaccard(keyWords(a.title), keyWords(b.title)), TITLE_LIMIT);
  if (a.hook && b.hook && words(a.hook).length >= 5) add("kanca", jaccard(shingles(words(a.hook), 2), shingles(words(b.hook), 2)), HOOK_LIMIT);
  if (!res.length) return null;
  return res.reduce((m, r) => (r.score > m.score ? r : m));
}

/** `others` içindeki en benzer içerik; eşik aşılmışsa döner, yoksa null */
export function findDuplicate(item: Comparable, others: Comparable[]): Match | null {
  let best: Match | null = null;
  for (const o of others) {
    if (o.id && o.id === item.id) continue;
    const m = compare(item, o);
    if (m && (!best || m.score > best.score)) best = m;
  }
  return best && best.score >= 1 ? best : null;
}

export const describeMatch = (m: Match) => `"${m.title}" videosuyla ${m.field} %${Math.round(m.raw * 100)} örtüşüyor`;

/** Kanalın karşılaştırma için önceki içerikleri (yazılmakta olanlar hariç) */
export async function channelCorpus(channelId: string | null, take = 300): Promise<Comparable[]> {
  return prisma.contentItem.findMany({
    where: { channelId, status: { notIn: ["WRITING"] }, script: { not: "" } },
    select: { id: true, title: true, hook: true, script: true },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * Claude'a verilecek "tekrar etme" listesi ve çeşitlilik notu:
 * sadece konular değil başlıklar ve kanca açılışları da (aynı kalıpla başlayan videolar tekrar sayılır).
 */
export function avoidLines(corpus: Comparable[], take = 80): string[] {
  return corpus.slice(0, take).map((c) => {
    const open = words(c.hook ?? "").slice(0, 5).join(" ");
    return `${c.title}${open ? ` (kanca: "${open}…")` : ""}`;
  });
}

/** Son videolarda en sık kullanılan kanca açılışları: Claude bunlardan kaçınsın */
export function overusedOpeners(corpus: Comparable[], take = 40): string[] {
  const count = new Map<string, number>();
  for (const c of corpus.slice(0, take)) {
    const open = words(c.hook || c.script || "").slice(0, 2).join(" ");
    if (open) count.set(open, (count.get(open) ?? 0) + 1);
  }
  return [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([o]) => o);
}

export const ORIGINALITY_RULES = `Özgünlük (YouTube'un tekrarlayan ve yeniden kullanılan içerik politikası nedeniyle zorunlu):
- Her video kendi başına değerli, farklı bir bilgi ya da bakış açısı sunsun; aynı metni kelime değiştirerek yeniden yazma.
- Kanca yapılarını çeşitlendir: soru, şaşırtıcı iddia, kısa hikâye anı, karşılaştırma, hata, sayı... Ardışık videolar aynı kalıpla başlamasın.
- Başlıklar aynı şablonu tekrar etmesin (ör. hepsi "X'in sırrı" veya "Bunu bilmiyordun" gibi olmasın).
- Kapanış/etkileşim cümlesini her videoda farklı yaz; sabit bir slogan tekrar etme.`;

/** Kısa ve deterministik tohum: aynı video hep aynı, farklı videolar farklı kurgu alır */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}
