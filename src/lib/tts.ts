import fs from "node:fs/promises";
import { ffmpeg } from "./ffmpeg";
import { cfg } from "./config";

export type Word = { word: string; start: number; end: number };
export type TtsResult = { audioPath: string; words: Word[]; duration: number };

/** ElevenLabs karakter zamanlamalarını kelime zamanlamalarına çevirir */
export function charsToWords(chars: string[], starts: number[], ends: number[]): Word[] {
  const words: Word[] = [];
  let cur: Word | null = null;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/\s/.test(c)) {
      if (cur) words.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { word: c, start: starts[i], end: ends[i] };
    else {
      cur.word += c;
      cur.end = ends[i];
    }
  }
  if (cur) words.push(cur);
  return words;
}

async function elevenLabs(text: string, voiceId: string, outPath: string): Promise<TtsResult> {
  const c = await cfg();
  const key = c.elevenApiKey;
  if (!key) throw new Error("ElevenLabs API anahtarı girilmemiş (Ayarlar → API anahtarları)");
  if (!voiceId) throw new Error("Ayarlarda ElevenLabs sesi seçilmemiş");
  if (voiceId.startsWith("sk_")) throw new Error("Ses alanına API anahtarı girilmiş; Ayarlar'dan listeden bir ses seçin");
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: c.elevenModelId,
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs hatası ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = (await res.json()) as {
    audio_base64: string;
    alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
  };
  await fs.writeFile(outPath, Buffer.from(data.audio_base64, "base64"));
  const a = data.alignment;
  const words = charsToWords(a.characters, a.character_start_times_seconds, a.character_end_times_seconds);
  const duration = a.character_end_times_seconds.at(-1) ?? words.at(-1)?.end ?? 0;
  return { audioPath: outPath, words, duration };
}

/** Anahtarsız deneme için: sessiz ses + tahmini kelime zamanları */
async function mock(text: string, outPath: string): Promise<TtsResult> {
  const tokens = text.split(/\s+/).filter(Boolean);
  const per = 0.38;
  const words = tokens.map((w, i) => ({ word: w, start: i * per, end: i * per + per * 0.9 }));
  const duration = tokens.length * per + 0.3;
  await ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", duration.toFixed(2), "-c:a", "libmp3lame", outPath]);
  return { audioPath: outPath, words, duration };
}

export async function synthesize(provider: string, text: string, voiceId: string, outPath: string) {
  return provider === "elevenlabs" ? elevenLabs(text, voiceId, outPath) : mock(text, outPath);
}

export type Voice = { voice_id: string; name: string; labels?: Record<string, string> };

/** ElevenLabs hesabındaki sesler (panelde seçim için) */
export async function listVoices(apiKey: string): Promise<Voice[]> {
  const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey }, cache: "no-store" });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = (await r.json()) as { voices: Voice[] };
  return data.voices;
}

/** ElevenLabs Speech-to-Text: ses/video dosyasındaki konuşmayı kelime zamanlarıyla çıkarır */
export async function transcribe(filePath: string, language?: string): Promise<Word[]> {
  const c = await cfg();
  if (!c.elevenApiKey) throw new Error("ElevenLabs API anahtarı girilmemiş");
  const audio = await fs.readFile(filePath);
  const send = (model: string) => {
    const form = new FormData();
    form.append("model_id", model);
    form.append("timestamps_granularity", "word");
    form.append("tag_audio_events", "false");
    if (language) form.append("language_code", language);
    form.append("file", new Blob([audio], { type: "audio/mpeg" }), "audio.mp3");
    return fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": c.elevenApiKey }, body: form });
  };
  let r = await send("scribe_v2");
  if (r.status === 400 || r.status === 422) r = await send("scribe_v1");
  if (!r.ok) throw new Error(`ElevenLabs konuşma tanıma hatası ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { words?: { text: string; start: number | null; end: number | null; type: string }[] };
  return (j.words ?? [])
    .filter((w) => w.type === "word" && w.start != null && w.end != null)
    .map((w) => ({ word: w.text.trim(), start: w.start!, end: w.end! }))
    .filter((w) => w.word);
}
