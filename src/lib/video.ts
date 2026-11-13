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

function zoompanFor(i: number, frames: number) {
  const F = frames;
  switch (i % 4) {
    case 0: // yakınlaş
      return `zoompan=z='1+0.18*on/${F}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    case 1: // uzaklaş
      return `zoompan=z='1.18-0.18*on/${F}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
    case 2: // sağa kaydır
      return `zoompan=z='1.15':x='(iw-iw/zoom)*on/${F}':y='ih/2-(ih/zoom/2)'`;
    default: // yukarı kaydır
      return `zoompan=z='1.15':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-on/${F})'`;
  }
}

function assTime(t: number) {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

const clean = (w: string) => w.replace(/[{}\\]/g, "");

/** Kelime kelime vurgulu, 3'lü gruplar halinde altyazı (ASS) */
export function buildAss(words: Word[], font = process.env.SUBTITLE_FONT || "Arial"): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${font},88,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,3,2,80,80,560,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const groups: Word[][] = [];
  let g: Word[] = [];
  for (const w of words) {
    g.push(w);
    const long = g.length >= 3 || w.end - g[0].start > 1.3 || /[.!?,;:]$/.test(w.word);
    if (long) {
      groups.push(g);
      g = [];
    }
  }
  if (g.length) groups.push(g);

  const lines: string[] = [];
  for (const grp of groups) {
    grp.forEach((w, i) => {
      const end = i + 1 < grp.length ? grp[i + 1].start : w.end + 0.15;
      const text = grp
        .map((x, j) => {
          const t = clean(x.word).toLocaleUpperCase("tr-TR");
          return j === i ? `{\\c&H00E6FF&\\fscx110\\fscy110}${t}{\\c&HFFFFFF&\\fscx100\\fscy100}` : t;
        })
        .join(" ");
      lines.push(`Dialogue: 0,${assTime(w.start)},${assTime(end)},Default,,0,0,0,,${text}`);
    });
  }
  return header + lines.join("\n") + "\n";
}

/** Görseller + ses + altyazı -> 1080x1920 MP4 */
export async function renderVideo(opts: { dir: string; scenes: Scene[]; audioPath: string; words: Word[]; outPath: string }) {
  const { dir, scenes, audioPath, words, outPath } = opts;
  const clips: string[] = [];
  const durations: number[] = [];

  // 1) Her sahne için Ken Burns klibi
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!s.image) throw new Error(`Sahne ${i + 1} için görsel yok`);
    const isLast = i === scenes.length - 1;
    const dur = Math.max(1.2, s.end - s.start + (isLast ? 0 : XFADE));
    const frames = Math.ceil(dur * FPS);
    const clip = path.join(dir, `clip_${String(i).padStart(2, "0")}.mp4`);
    await ffmpeg([
      "-loop", "1", "-i", s.image,
      "-vf", `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},${zoompanFor(i, frames)}:d=${frames}:s=${W}x${H}:fps=${FPS},format=yuv420p`,
      "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", clip,
    ]);
    clips.push(clip);
    durations.push(frames / FPS);
  }

  // 2) Geçişler + altyazı + ses
  const assPath = path.join(dir, "subs.ass");
  await fs.writeFile(assPath, buildAss(words), "utf8");

  const inputs = clips.flatMap((c) => ["-i", c]);
  const filters: string[] = [];
  let prev = "[0:v]";
  let offset = 0;
  for (let i = 1; i < clips.length; i++) {
    offset += durations[i - 1] - XFADE;
    const out = `[x${i}]`;
    filters.push(`${prev}[${i}:v]xfade=transition=${TRANSITIONS[(i - 1) % TRANSITIONS.length]}:duration=${XFADE}:offset=${offset.toFixed(3)}${out}`);
    prev = out;
  }
  // ass filtresi yol içindeki ':' ve '\' karakterlerinden etkilenir; göreli yol kullan
  const assRel = path.relative(process.cwd(), assPath).replace(/\\/g, "/").replace(/:/g, "\\:");
  filters.push(`${prev}ass='${assRel}'[v]`);

  await ffmpeg([
    ...inputs,
    "-i", audioPath,
    "-filter_complex", filters.join(";"),
    "-map", "[v]", "-map", `${clips.length}:a`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
    outPath,
  ]);

  // ara dosyaları temizle
  await Promise.all(clips.map((c) => fs.rm(c, { force: true })));
}
