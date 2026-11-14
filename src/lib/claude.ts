import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AppSettings } from "./settings";
import { cfg } from "./config";
// Politika reddinde API isteği otomatik olarak uygun bir modelde yeniden çalıştırır.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

async function client() {
  const c = await cfg();
  if (!c.anthropicApiKey) throw new Error("Claude API anahtarı girilmemiş (Ayarlar → API anahtarları)");
  return { api: new Anthropic({ apiKey: c.anthropicApiKey }), model: c.claudeModel };
}

/** Anahtar testi: hafif bir istek */
export async function testClaude(): Promise<string> {
  const { api, model } = await client();
  const m = await api.models.retrieve(model, {}, { timeout: 15_000, maxRetries: 0 });
  return `bağlandı (${m.display_name})`;
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

  const { api, model } = await client();
  for (let i = 0; i < 5; i++) {
    const stream = api.beta.messages.stream({
      model,
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
  const { api, model } = await client();
  const res = await api.beta.messages.parse({
    model,
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
export async function planScenes(
  s: AppSettings,
  script: string,
  topic: string,
  opts: { minScenes?: number; maxScenes?: number; characters?: string } = {},
): Promise<ScenePlanT> {
  const minS = opts.minScenes ?? 6;
  const maxS = opts.maxScenes ?? 10;
  const { api, model } = await client();
  const res = await api.beta.messages.parse({
    model,
    max_tokens: 16000,
    output_config: { effort: "low", format: betaZodOutputFormat(ScenePlan) },
    messages: [
      {
        role: "user",
        content: `Aşağıdaki Shorts metnini ${minS}-${maxS} sahneye böl. Sahne metinleri birleştirildiğinde orijinal metnin aynısı olmalı (sırayı ve kelimeleri değiştirme). Her sahne 3-7 saniye sürecek kadar metin içersin; izleyici sıkılmasın diye görüntü sık değişsin.

Her sahne için bir görsel istemi yaz. Tüm görseller aynı çizim stilinde olacak:
"${s.visualStyle}"
İstemler İngilizce olsun, sadece sahnenin içeriğini anlatsın (stil ayrıca eklenecek), görselde yazı, harf, logo olmasın. Dikey (9:16) kompozisyon düşün, ana öğe ortada.
Sinematik çekim açılarını çeşitlendir: geniş açı, sürücü koltuğundan bakış, ele yakın çekim (telefon, direksiyon, radyo), karakterin yüzüne yakın çekim, dikiz aynası vb.
${opts.characters ? `Karakterler sahnede göründüğünde bu tariflere birebir uy (styleAnchor'a da ekle):\n${opts.characters}` : ""}

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

// ---------------- Etkileşimli hikâye dizisi ----------------

export const STORY_VISUAL_STYLE =
  "minimalist flat 2D vector motion-graphics illustration, simple stylized characters with large round pale heads, small dot eyes, simple brows and thin line limbs, dark navy night color palette, cinematic moody lighting with glowing light sources (red taillights, street lamps, phone and dashboard screens), soft gradients, clean geometric shapes, subtle vignette, no outlines texture";

const SeriesBible = z.object({
  seriesTitle: z.string().describe("Kısa, akılda kalıcı dizi adı (1-3 kelime)"),
  premise: z.string().describe("Dizinin dünyası, ana gizem/gerilim, tonu; 4-6 cümle"),
  characters: z
    .string()
    .describe("İngilizce: ana karakterlerin GÖRSEL tarifi (kıyafet rengi, saç, ayırt edici öğe), her biri tek satır; görsel tutarlılık için"),
});

const Episode = z.object({
  title: z.string().describe("Bölüm adı, 2-4 kelime (ör. 'Kontağı Kapat')"),
  script: z.string().describe("Seslendirilecek anlatım metni"),
  choiceA: z.string().describe("A seçeneği, en fazla 4 kelime, emir kipi (ör. 'Camı aç ve dinle')"),
  choiceB: z.string().describe("B seçeneği, en fazla 4 kelime"),
  summary: z.string().describe("Bu bölümde olanların 3-4 cümlelik özeti (devamlılık için)"),
  description: z.string().describe("YouTube açıklaması: 1-2 cümle merak uyandıran özet + 'Yorumlara A veya B yaz!' + 3-5 hashtag"),
  tags: z.array(z.string()).describe("8-15 etiket"),
});
export type EpisodeT = z.infer<typeof Episode>;
export type SeriesBibleT = z.infer<typeof SeriesBible>;

/** Dizinin konusu ve karakterleri boşsa Claude oluşturur */
export async function createSeriesBible(s: AppSettings): Promise<SeriesBibleT> {
  const { api, model } = await client();
  const res = await api.beta.messages.parse({
    model,
    max_tokens: 8000,
    output_config: { effort: "medium", format: betaZodOutputFormat(SeriesBible) },
    messages: [
      {
        role: "user",
        content: `YouTube Shorts için izleyicinin her bölüm sonunda A/B seçimiyle yön verdiği, bölümlü bir gerilim/gizem hikâyesi dizisi tasarla.
Tür/niş: ${s.niche || "gündelik hayatta geçen gerilim ve gizem"}
${s.seriesTitle ? `Dizi adı: ${s.seriesTitle}` : ""}
${s.seriesPremise ? `Kullanıcının fikri: ${s.seriesPremise}` : ""}
Dil: ${langName(s.language)}
Görsel stil: ${s.visualStyle}
Gündelik, tanıdık bir mekânda başlasın (trafik, apartman, gece vardiyası vb.), birinci ağızdan ("sen") anlatılmaya uygun olsun. Ana karakter izleyicinin kendisi.`,
      },
    ],
    ...FALLBACK,
  });
  if (res.stop_reason === "refusal") throw new Error("Claude dizi oluşturma isteğini reddetti");
  if (!res.parsed_output) throw new Error("Dizi bilgisi ayrıştırılamadı");
  return res.parsed_output;
}

/** Sıradaki bölümü yazar */
export async function writeEpisode(
  s: AppSettings,
  opts: {
    episodeNumber: number;
    previous: { episodeNumber: number; title: string; summary: string; choiceA: string; choiceB: string; chosen?: string | null }[];
    chosenText?: string; // önceki bölümde izleyicinin seçtiği seçenek
    topicHint?: string;
  },
): Promise<EpisodeT> {
  const words = Math.round(s.storyMinutes * 150);
  const { api, model } = await client();
  const history = opts.previous
    .map((p) => `Bölüm ${p.episodeNumber} "${p.title}": ${p.summary}\nSeçenekler: A) ${p.choiceA}  B) ${p.choiceB}${p.chosen ? `\nİzleyicinin seçimi: ${p.chosen}` : ""}`)
    .join("\n\n");
  const res = await api.beta.messages.parse({
    model,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaZodOutputFormat(Episode) },
    system: `Sen YouTube Shorts için etkileşimli gerilim hikâyeleri yazan bir senaristsin.
Anlatım ikinci tekil şahısla ("sen") ve şimdiki zamanla yapılır; izleyici hikâyenin kahramanıdır.
Kısa, ritmik, görsel cümleler kur. Saat, mekân, ses gibi somut ayrıntılar ver. Emoji, sahne yönergesi, başlık yazma.
Kan, şiddet ayrıntısı ve korku pornografisi yok; gerilim atmosferle kurulur.
Tüm çıktı ${langName(s.language)} dilinde olsun.`,
    messages: [
      {
        role: "user",
        content: `Dizi: ${s.seriesTitle}
Konu: ${s.seriesPremise}

${history ? `Önceki bölümler:\n${history}\n` : "Bu dizinin İLK bölümü.\n"}
${opts.chosenText ? `İzleyiciler önceki bölümün sonunda şunu seçti: "${opts.chosenText}". Bölüm doğrudan bu seçimin sonucuyla başlasın.\n` : ""}
${opts.topicHint ? `Kullanıcının bu bölüm için isteği: ${opts.topicHint}\n` : ""}
Bölüm ${opts.episodeNumber}'i yaz:
- Yaklaşık ${words} kelime (${s.storyMinutes} dakika seslendirme)
- İlk cümle güçlü bir kanca olsun (saat/mekân/tuhaf bir ayrıntı)
- Gerilim adım adım artsın, bölüm tam karar anında dursun
- Metnin son cümleleri seçimi sorsun: "Ne yaparsın? A: ... mı, yoksa B: ... mi? Kararını yorumlara yaz."
- İki seçenek de makul ve merak uyandırıcı olsun, biri açıkça "doğru" olmasın`,
      },
    ],
    ...FALLBACK,
  });
  if (res.stop_reason === "refusal") throw new Error("Claude bölüm yazma isteğini reddetti");
  if (!res.parsed_output) throw new Error(`Bölüm ayrıştırılamadı (stop_reason=${res.stop_reason})`);
  return res.parsed_output;
}

// ---------------- Claude ile sahne çizimi (SVG) ----------------

const SVG_STYLE_GUIDE = `You are an illustrator for a minimal, flat 2D motion-graphics YouTube Shorts channel. You draw ONE vertical scene as a single SVG that will be animated with a 2.5D parallax camera.

Canvas: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">.

Structure (required, the animation depends on it):
- Put ALL gradients and filters in one <defs> directly under <svg>.
- Then exactly three top-level groups, in this order:
  <g id="bg"> far background that fills the WHOLE canvas edge to edge (sky, walls, distant buildings, floor). It must be fully opaque.
  <g id="mid"> the subject: characters, the main object, its light glows. Transparent everywhere else.
  <g id="fg"> 1-4 sparse, dark, near-camera silhouettes at the edges (a doorframe edge, a table edge, a railing, leaves, a curtain) for depth. Keep it light; it must never cover faces or the focal object. It may be empty.
- Never draw anything outside these groups. No vignette (it is added later).

Style rules (keep every scene consistent):
- Follow the channel's visual style given with the scene. When no palette is specified use this default night palette: background gradients #070b16 to #141b2d; mid shapes #1c2538 / #26314a / #33405e; silhouettes #0a0f1c; glows (radialGradient fading to transparent) red #e6303b, warm lamp #ffd27a, screen blue #3fb6ff, highlights #c9d3e6.
- Flat vector shapes only: rect, circle, ellipse, path, polygon, line, linearGradient, radialGradient, simple filters (feGaussianBlur for glows). No images, no external references, no <text>, no letters, no numbers, no logos.
- Characters: large round pale heads (#dfe6f2), two small dark dot eyes, a short thin brow line that shows emotion, no mouth or a tiny line, simple rounded torso in a flat clothing color, thin stroke limbs (stroke-width 10-16, round caps). Keep them simple and readable. Give them a clear pose that acts out the scene.
- Cinematic composition for 9:16: one clear focal point, strong silhouettes, light that guides the eye to the subject.
- Safe areas: the camera zooms and pans, so keep every important element (faces, hands, key objects) inside x 140-940 and y 220-1700. Never crop a head or hat at the canvas edge.
- Subtitles are burned in over the band y 1180-1480: keep faces and the focal object out of that band (place them above it, roughly y 350-1150); background, floor or bodies may pass behind it.
- Make each scene clearly different from the previous ones in camera angle and framing (wide, close-up, over-the-shoulder, detail shot), and include a few small details (props, windows, stars, steam, papers) so the frame doesn't feel empty.
- Keep the SVG compact: at most about 140 elements.

Reply with ONLY the SVG markup, starting with <svg and ending with </svg>. No explanation, no markdown fences.`;

/** Sahneyi Claude'a SVG olarak çizdirir; geçerli <svg>…</svg> döndürür */
export async function drawSceneSvg(prompt: string, characters?: string): Promise<string> {
  const { api, model } = await client();
  const res = await api.beta.messages.create({
    model,
    max_tokens: 16000,
    output_config: { effort: "low" },
    system: SVG_STYLE_GUIDE,
    messages: [
      {
        role: "user",
        content: `${characters ? `Recurring characters (draw them exactly like this whenever they appear):\n${characters}\n\n` : ""}Scene to draw:\n${prompt}`,
      },
    ],
    ...FALLBACK,
  });
  if (res.stop_reason === "refusal") throw new Error("Claude sahne çizimini reddetti");
  const text = textOf(res.content);
  const m = text.match(/<svg[\s\S]*<\/svg>/i);
  if (!m) throw new Error(`Claude geçerli SVG döndürmedi (stop_reason=${res.stop_reason})`);
  return m[0];
}
