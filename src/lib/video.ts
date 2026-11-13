import fs from "node:fs/promises";
import path from "node:path";
import { ffmpeg } from "./ffmpeg";
import type { Word } from "./tts";

export type Scene = { text: string; imagePrompt: string; start: number; end: number; image?: string };

const W = 1080;
const H = 1920;
const FPS = 30;
const XFADE = 0.4; // geçiş süresi (sn)
const TRANSITIONS = ["fade", "smoothleft", "smoothup", "circleopen", "slideleft", "fadeblack", "smoothright", "radial"];

/** Sahne metinlerini kelime sayısına göre ses zamanlamasına oturtur */
export function timeScenes(scenes: { text: string; imagePrompt: string }[], words: Word[], duration: number): Scene[] {
  const counts = scenes.map((s) => Math.max(1, s.text.split(/\s+/).filter(Boolean).length));
  const total = counts.reduce((a, b) => a + b, 0);
  const scale = words.length / total; // Claude metni birebir bölmediyse orantılı eşle
  let idx = 0;
  return scenes.map((s, i) => {
    const startWord = Math.min(words.length - 1, Math.round(idx * scale));
    idx += counts[i];
    const start = i === 0 ? 0 : words[startWord]?.start ?? 0;
    return { ...s, start, end: 0 };
  }).map((s, i, arr) => ({ ...s, end: i + 1 < arr.length ? arr[i + 1].start : duration + 0.4 }));
}

function zoompanFor(i: number, frames: number, motion: Motion) {
  const F = frames;
  const z = motion === "slow" ? 0.08 : 0.18; // hikâye modunda daha sakin kamera
  const p = motion === "slow" ? 1.07 : 1.15;
  switch (i % 4) {
    case 0: // yakınlaş
      return `zoompan=z='1+${z}*on/${F}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    case 1: // uzaklaş
      return `zoompan=z='${1 + z}-${z}*on/${F}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    case 2: // sağa kaydır
      return `zoompan=z='${p}':x='(iw-iw/zoom)*on/${F}':y='ih/2-(ih/zoom/2)'`;
    default: // yukarı kaydır
      return `zoompan=z='${p}':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-on/${F})'`;
  }
}

// Shorts için yaygın ses seviyesi (~-14 LUFS); ElevenLabs çıktısı -23 civarında kalıyordu
const LOUD = "loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000";

function assTime(t: number) {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

const clean = (w: string) => w.replace(/[{}\\]/g, "").replace(/\n/g, " ");
const upper = (w: string) => clean(w).toLocaleUpperCase("tr-TR");

export type Motion = "normal" | "slow";
export type SubtitleStyle = "karaoke" | "minimal" | "off";
export type Overlays = {
  subtitleStyle?: SubtitleStyle;
  titleCard?: { title: string; badge: string }; // açılış: dizi adı + "BÖLÜM 1 · ..."
  endCard?: { choiceA: string; choiceB: string; start: number; end: number }; // seçim ekranı
  watermark?: string;
};

/** Altyazı + açılış/seçim kartları + filigran (ASS) */
export function buildAss(words: Word[], o: Overlays = {}, total = 0): string {
  const font = process.env.SUBTITLE_FONT || "Arial";
  const title = process.env.TITLE_FONT || "Impact";
  const style = o.subtitleStyle ?? "karaoke";
  // Renkler ASS'de &HAABBGGRR
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,${font},88,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,3,2,80,80,560,1
Style: Minimal,${font},56,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,3,2,2,90,90,330,1
Style: Title,${title},150,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,2,0,1,0,6,4,70,70,0,1
Style: Badge,${font},44,&H00FFFFFF,&H00FFFFFF,&H003B30E6,&H00000000,-1,0,0,0,100,100,1,0,3,10,0,4,70,70,0,1
Style: Big,${title},120,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,2,0,1,0,5,5,60,60,0,1
Style: BigRed,${title},140,&H003B30E6,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,2,0,1,0,5,5,60,60,0,1
Style: Option,${font},54,&H00FFFFFF,&H00FFFFFF,&H00241A16,&H00000000,-1,0,0,0,100,100,1,0,3,22,0,4,110,110,0,1
Style: Small,${font},50,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,1,0,1,0,3,5,60,60,0,1
Style: SmallRed,${font},42,&H003B30E6,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,1,0,1,0,3,5,60,60,0,1
Style: Mark,${font},34,&H50FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,9,50,50,60,1
Style: Shade,${font},10,&H00000000,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines: string[] = [];
  const ev = (layer: number, a: number, b: number, st: string, text: string) =>
    lines.push(`Dialogue: ${layer},${assTime(a)},${assTime(b)},${st},,0,0,0,,${text}`);

  // Altyazı
  const subEnd = o.endCard ? o.endCard.start : Infinity;
  if (style !== "off") {
    const maxWords = style === "karaoke" ? 3 : 6;
    const maxSec = style === "karaoke" ? 1.3 : 2.4;
    const groups: Word[][] = [];
    let g: Word[] = [];
    for (const w of words) {
      if (w.start >= subEnd) break;
      g.push(w);
      if (g.length >= maxWords || w.end - g[0].start > maxSec || /[.!?,;:]$/.test(w.word)) {
        groups.push(g);
        g = [];
      }
    }
    if (g.length) groups.push(g);
    const titleEnd = o.titleCard ? 3.2 : 0;
    groups.forEach((grp, gi) => {
      // Bir sonraki grup başlamadan biter; çakışan satırlar üst üste binmez
      const nextStart = gi + 1 < groups.length ? groups[gi + 1][0].start : Infinity;
      if (style === "karaoke") {
        grp.forEach((w, i) => {
          const end = i + 1 < grp.length ? grp[i + 1].start : Math.min(w.end + 0.15, nextStart);
          const text = grp
            .map((x, j) => (j === i ? `{\\c&H00E6FF&\\fscx110\\fscy110}${upper(x.word)}{\\c&HFFFFFF&\\fscx100\\fscy100}` : upper(x.word)))
            .join(" ");
          ev(1, Math.max(w.start, titleEnd), Math.min(end, subEnd), "Karaoke", text);
        });
      } else {
        const a = Math.max(grp[0].start, titleEnd);
        const b = Math.min(grp.at(-1)!.end + 0.2, nextStart, subEnd);
        if (b > a) ev(1, a, b, "Minimal", grp.map((x) => clean(x.word)).join(" "));
      }
    });
  }

  // Açılış kartı: dizi adı + kırmızı bölüm etiketi
  if (o.titleCard) {
    const fade = "{\\fad(250,400)}";
    ev(2, 0, 3.2, "Title", `${fade}{\\pos(70,700)}${upper(o.titleCard.title)}`);
    ev(2, 0, 3.2, "Badge", `${fade}{\\pos(80,800)}${upper(o.titleCard.badge)}`);
  }

  // Seçim ekranı
  if (o.endCard) {
    const { start: a, end: b } = o.endCard;
    ev(0, a, b, "Shade", `{\\fad(300,0)\\an7\\pos(0,0)\\1a&H50&\\p1}m 0 0 l ${W} 0 ${W} ${H} 0 ${H}{\\p0}`);
    ev(2, a, b, "Big", `{\\fad(300,0)\\pos(${W / 2},620)}ŞİMDİ`);
    ev(2, a + 0.2, b, "BigRed", `{\\fad(300,0)\\pos(${W / 2},760)}KARAR SENİN`);
    ev(2, a + 0.6, b, "Option", `{\\fad(250,0)\\pos(110,930)}{\\c&H3B30E6&}A{\\c&HFFFFFF&}   ${upper(o.endCard.choiceA)}`);
    ev(2, a + 1.0, b, "Option", `{\\fad(250,0)\\pos(110,1060)}{\\c&H3B30E6&}B{\\c&HFFFFFF&}   ${upper(o.endCard.choiceB)}`);
    ev(2, a + 1.5, b, "Small", `{\\fad(250,0)\\pos(${W / 2},1230)}KARAR SENİN!`);
    ev(2, a + 1.5, b, "SmallRed", `{\\fad(250,0)\\pos(${W / 2},1290)}YORUMLARA A VEYA B YAZ.`);
  }

  if (o.watermark && total > 0) ev(3, 0, total, "Mark", clean(o.watermark));
  return header + lines.join("\n") + "\n";
}

async function pickMusic(): Promise<string | null> {
  const dir = path.resolve(process.env.MUSIC_DIR || "./music");
  try {
    const files = (await fs.readdir(dir)).filter((f) => /\.(mp3|m4a|wav|ogg)$/i.test(f));
    if (!files.length) return null;
    return path.join(dir, files[Math.floor(Math.random() * files.length)]);
  } catch {
    return null;
  }
}

/** Görseller + ses + altyazı/kartlar (+ isteğe bağlı müzik) -> 1080x1920 MP4 */
export async function renderVideo(opts: {
  dir: string;
  scenes: Scene[];
  audioPath: string;
  words: Word[];
  outPath: string;
  motion?: Motion;
  transition?: "varied" | "fade";
  overlays?: Overlays;
  endCardSeconds?: number; // seçim ekranı için son sahneyi uzatır
  musicVolume?: number;
}) {
  const { dir, scenes, audioPath, words, outPath } = opts;
  const motion = opts.motion ?? "normal";
  const xf = opts.transition === "fade" ? 0.3 : XFADE;
  const endSec = opts.endCardSeconds ?? 0;
  const clips: string[] = [];
  const durations: number[] = [];

  // 1) Her sahne için Ken Burns klibi
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!s.image) throw new Error(`Sahne ${i + 1} için görsel yok`);
    const isLast = i === scenes.length - 1;
    const dur = Math.max(1.2, s.end - s.start + (isLast ? endSec : xf));
    const frames = Math.ceil(dur * FPS);
    const clip = path.join(dir, `clip_${String(i).padStart(2, "0")}.mp4`);
    await ffmpeg([
      "-loop", "1", "-i", s.image,
      "-vf", `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},${zoompanFor(i, frames, motion)}:d=${frames}:s=${W}x${H}:fps=${FPS},format=yuv420p`,
      "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", clip,
    ]);
    clips.push(clip);
    durations.push(frames / FPS);
  }
  const total = durations.reduce((a, b) => a + b, 0) - xf * (clips.length - 1);

  // 2) Altyazı ve kartlar
  const overlays = { ...opts.overlays };
  if (overlays.endCard) overlays.endCard = { ...overlays.endCard, start: total - endSec, end: total };
  const assPath = path.join(dir, "subs.ass");
  await fs.writeFile(assPath, buildAss(words, overlays, total), "utf8");

  // 3) Geçişler + ses (+ müzik)
  const inputs = clips.flatMap((c) => ["-i", c]);
  const filters: string[] = [];
  let prev = "[0:v]";
  let offset = 0;
  for (let i = 1; i < clips.length; i++) {
    offset += durations[i - 1] - xf;
    const out = `[x${i}]`;
    const tr = opts.transition === "fade" ? "fade" : TRANSITIONS[(i - 1) % TRANSITIONS.length];
    filters.push(`${prev}[${i}:v]xfade=transition=${tr}:duration=${xf}:offset=${offset.toFixed(3)}${out}`);
    prev = out;
  }
  // ass filtresi yol içindeki ':' ve '\\' karakterlerinden etkilenir; göreli yol kullan
  const assRel = path.relative(process.cwd(), assPath).replace(/\\/g, "/").replace(/:/g, "\\:");
  filters.push(`${prev}ass='${assRel}'[v]`);

  const audioIdx = clips.length;
  const music = opts.musicVolume ? await pickMusic() : null;
  const extra: string[] = ["-i", audioPath];
  if (music) {
    extra.push("-stream_loop", "-1", "-i", music);
    filters.push(`[${audioIdx}:a]apad[voice];[${audioIdx + 1}:a]volume=${opts.musicVolume}[bg];[voice][bg]amix=inputs=2:duration=first:normalize=0,${LOUD}[a]`);
  } else {
    filters.push(`[${audioIdx}:a]apad,${LOUD}[a]`);
  }

  await ffmpeg([
    ...inputs,
    ...extra,
    "-filter_complex", filters.join(";"),
    "-map", "[v]", "-map", "[a]",
    "-t", total.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    outPath,
  ]);

  // ara dosyaları temizle
  await Promise.all(clips.map((c) => fs.rm(c, { force: true })));
}
