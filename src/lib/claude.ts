import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AppSettings } from "./settings";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
// Politika reddinde API isteği otomatik olarak uygun bir modelde yeniden çalıştırır.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

let _client: Anthropic | null = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY tanımlı değil (.env)");
  return (_client ??= new Anthropic());
}

const LANG_NAMES: Record<string, string> = {
  tr: "Türkçe", en: "English", de: "Deutsch", es: "Español", fr: "Français", ar: "العربية", pt: "Português",
};
export const langName = (code: string) => LANG_NAMES[code] ?? code;

function textOf(content: Anthropic.Beta.BetaContentBlock[]) {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** 1) Niş araştırması: web araması ile güncel trendler, sık sorulan sorular, rakip formatlar */
export async function researchNiche(s: AppSettings): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `Bir YouTube Shorts kanalı için içerik araştırması yap.
Niş: ${s.niche}
Hedef dil/izleyici: ${langName(s.language)}
Kanal tonu: ${s.channelStyle}

Web aramasıyla şunları bul ve kısa bir araştırma raporu yaz:
- Bu nişte şu an ilgi gören konular, sorular ve merak edilen bilgiler
- Shorts'ta iyi performans gösteren kanca (hook) kalıpları ve formatlar
- 45-60 saniyelik bilgilendirici videoya uygun, doğrulanabilir 40+ konu fikri (her biri tek satır, kısa gerekçe)
- Kaçınılması gereken yanlış bilgiler veya hassas konular
Rapor ${langName(s.language)} dilinde olsun.`,
    },
  ];

  for (let i = 0; i < 5; i++) {
    const stream = client().beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      messages,
      ...FALLBACK,
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("Claude araştırma isteğini reddetti");
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    return textOf(msg.content);
  }
  throw new Error("Araştırma tamamlanamadı (pause_turn sınırı)");
}

const CalendarItem = z.object({
  topic: z.string().describe("Kısa konu başlığı"),
  hook: z.string().describe("İlk 2 saniyede söylenecek, merak uyandıran tek cümle"),
  script: z.string().describe("Seslendirilecek tam metin; kanca ile başlar, 110-150 kelime, 45-60 saniye"),
  title: z.string().describe("YouTube başlığı, en fazla 90 karakter, #Shorts içermez"),
  description: z.string().describe("2-4 cümlelik açıklama + 3-5 hashtag"),
  tags: z.array(z.string()).describe("8-15 etiket"),
});
const CalendarChunk = z.object({ items: z.array(CalendarItem) });
export type CalendarItemT = z.infer<typeof CalendarItem>;

/** 2) Araştırmaya dayanarak `count` adet video planı üretir (çağıran 30 günü parçalara böler) */
export async function generateCalendarChunk(
  s: AppSettings,
  research: string,
  count: number,
  avoidTopics: string[],
): Promise<CalendarItemT[]> {
  const res = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaZodOutputFormat(CalendarChunk) },
    system: `Sen deneyimli bir YouTube Shorts senaristisin. Bilgilendirici, doğru ve akıcı metinler yazarsın.
Metinler seslendirileceği için kısa cümleler kullan, emoji, madde işareti ve sahne yönergesi yazma.
Tüm çıktı ${langName(s.language)} dilinde olsun.`,
    messages: [
      {
        role: "user",
        content: `Niş: ${s.niche}
Kanal tonu: ${s.channelStyle}

Araştırma raporu:
<research>
${research}
</research>

${avoidTopics.length ? `Daha önce planlanan konular (tekrar etme):\n${avoidTopics.map((t) => "- " + t).join("\n")}\n` : ""}
Tam olarak ${count} farklı Shorts videosu planla. Her biri:
- Kanca ile başlayan, tek bir bilgiyi net anlatan, sonunda kısa bir merak/etkileşim cümlesi olan 110-150 kelimelik metin
- Sadece doğruluğundan emin olduğun bilgiler`,
      },
    ],
    ...FALLBACK,
  });
  if (res.stop_reason === "refusal") throw new Error("Claude takvim isteğini reddetti");
  if (!res.parsed_output) throw new Error(`Takvim çıktısı ayrıştırılamadı (stop_reason=${res.stop_reason})`);
  return res.parsed_output.items.slice(0, count);
}

const ScenePlan = z.object({
  styleAnchor: z
    .string()
    .describe("Tüm sahnelerde tekrar edilecek İngilizce görsel tutarlılık tanımı: ana karakter/nesne görünümü, renk paleti, ışık"),
  scenes: z.array(
    z.object({
      text: z.string().describe("Metnin bu sahneye düşen bölümü, kelimesi kelimesine"),
      imagePrompt: z.string().describe("İngilizce görsel istemi: sahnede ne görünüyor; yazı/harf içermez"),
    }),
  ),
});
export type ScenePlanT = z.infer<typeof ScenePlan>;

/** 3) Metni sahnelere böler ve her sahne için tutarlı stilde görsel istemi yazar */
export async function planScenes(s: AppSettings, script: string, topic: string): Promise<ScenePlanT> {
  const res = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: betaZodOutputFormat(ScenePlan) },
    messages: [
      {
        role: "user",
        content: `Aşağıdaki Shorts metnini 6-10 sahneye böl. Sahne metinleri birleştirildiğinde orijinal metnin aynısı olmalı (sırayı ve kelimeleri değiştirme). Her sahne 4-8 saniye sürecek kadar metin içersin.

Her sahne için bir görsel istemi yaz. Tüm görseller aynı çizim stilinde olacak:
"${s.visualStyle}"
İstemler İngilizce olsun, sadece sahnenin içeriğini anlatsın (stil ayrıca eklenecek), görselde yazı, harf, logo olmasın. Dikey (9:16) kompozisyon düşün, ana öğe ortada.

Konu: ${topic}
Metin:
"""${script}"""`,
      },
    ],
    ...FALLBACK,
  });
  if (res.stop_reason === "refusal") throw new Error("Claude sahne planı isteğini reddetti");
  if (!res.parsed_output?.scenes.length) throw new Error("Sahne planı ayrıştırılamadı");
  return res.parsed_output;
}
