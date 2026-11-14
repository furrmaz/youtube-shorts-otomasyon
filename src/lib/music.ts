import fs from "node:fs/promises";
import path from "node:path";
import { cfg } from "./config";
import { pickMusic } from "./video";
import type { AppSettings } from "./settings";

const MUSIC_DIR = () => path.resolve(process.env.MUSIC_DIR || "./music");
/** ElevenLabs ile üretilen parçalar bu sayıya ulaşınca yenisi üretilmez, kütüphaneden seçilir */
const LIBRARY_SIZE = 6;

function defaultPrompt(isStory: boolean) {
  return isStory
    ? "Dark cinematic suspense underscore, slow pulsing low synth drones, soft ticking, distant atmospheric pads, tense but quiet, no vocals, loopable"
    : "Light curious documentary background music, soft plucked piano and warm pads, gentle steady rhythm, unobtrusive, no vocals, loopable";
}

/** ElevenLabs Music API ile enstrümantal parça üretir */
export async function generateMusic(prompt: string, seconds: number, outPath: string) {
  const c = await cfg();
  if (!c.elevenApiKey) throw new Error("ElevenLabs API anahtarı girilmemiş");
  const res = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": c.elevenApiKey, "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      music_length_ms: Math.round(Math.min(300, Math.max(15, seconds)) * 1000),
      force_instrumental: true,
    }),
  });
  if (!res.ok) {
    const t = (await res.text()).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new Error(`ElevenLabs müzik izni yok (ücretli plan gerekebilir): ${t}`);
    throw new Error(`ElevenLabs müzik hatası ${res.status}: ${t}`);
  }
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

/**
 * Videonun arka plan müziği.
 * - folder: music/ klasöründen rastgele parça
 * - eleven: kütüphanede yeterli parça yoksa ElevenLabs ile yenisini üretip music/ klasörüne kaydeder
 */
export async function musicFor(s: AppSettings, isStory: boolean, seconds: number, log: (m: string, warn?: boolean) => Promise<void>) {
  if (s.musicSource === "off" || !s.musicVolume) return null;
  if (s.musicSource === "eleven") {
    const dir = MUSIC_DIR();
    const tag = isStory ? "hikaye" : "bilgi";
    const mine = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.startsWith(`eleven_${tag}_`));
    if (mine.length < LIBRARY_SIZE) {
      const out = path.join(dir, `eleven_${tag}_${Date.now()}.mp3`);
      try {
        await generateMusic(s.musicPrompt.trim() || defaultPrompt(isStory), Math.min(180, seconds + 5), out);
        await log(`Müzik üretildi (ElevenLabs): ${path.basename(out)}`);
        return out;
      } catch (e) {
        await log(`Müzik üretilemedi, klasördeki parçalar kullanılacak: ${(e as Error).message}`, true);
      }
    } else {
      return path.join(dir, mine[Math.floor(Math.random() * mine.length)]);
    }
  }
  return pickMusic();
}
