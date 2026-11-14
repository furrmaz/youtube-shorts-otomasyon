import fs from "node:fs/promises";
import { ffmpeg } from "./ffmpeg";
import { cfg } from "./config";
import { drawSceneSvg } from "./claude";
import { prisma } from "./db";

/**
 * Görsel sağlayıcı arayüzü. Yeni bir sağlayıcı (ör. Higgsfield) eklemek için
 * bu imzaya uyan bir fonksiyon yazıp PROVIDERS'a eklemek yeterli.
 */
type ImageProvider = (prompt: string, outPath: string, seed: number) => Promise<void>;

async function download(url: string, outPath: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Görsel indirilemedi ${r.status}`);
  await fs.writeFile(outPath, Buffer.from(await r.arrayBuffer()));
}

const fal: ImageProvider = async (prompt, outPath, seed) => {
  const c = await cfg();
  const key = c.falKey;
  if (!key) throw new Error("fal.ai anahtarı girilmemiş (Ayarlar → API anahtarları)");
  const model = c.falModel;
  const r = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt, image_size: "portrait_16_9", num_images: 1, seed, enable_safety_checker: true }),
  });
  if (!r.ok) throw new Error(`fal.ai hatası ${r.status}: ${(await r.text()).slice(0, 400)}`);
  const data = (await r.json()) as { images?: { url: string }[] };
  const url = data.images?.[0]?.url;
  if (!url) throw new Error("fal.ai görsel döndürmedi");
  await download(url, outPath);
};

const replicate: ImageProvider = async (prompt, outPath, seed) => {
  const c = await cfg();
  const token = c.replicateToken;
  if (!token) throw new Error("Replicate anahtarı girilmemiş (Ayarlar → API anahtarları)");
  const model = c.replicateModel;
  const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json", Prefer: "wait" };
  let r = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: { prompt, aspect_ratio: "9:16", output_format: "png", seed } }),
  });
  if (!r.ok) throw new Error(`Replicate hatası ${r.status}: ${(await r.text()).slice(0, 400)}`);
  let pred = (await r.json()) as { status: string; output?: string | string[]; error?: string; urls: { get: string } };
  for (let i = 0; i < 60 && !["succeeded", "failed", "canceled"].includes(pred.status); i++) {
    await new Promise((res) => setTimeout(res, 2000));
    r = await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${token}` } });
    pred = await r.json();
  }
  if (pred.status !== "succeeded") throw new Error(`Replicate başarısız: ${pred.error ?? pred.status}`);
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!url) throw new Error("Replicate görsel döndürmedi");
  await download(url, outPath);
};

/** Anahtarsız deneme için: renkli degrade arka plan */
const mock: ImageProvider = async (_prompt, outPath, seed) => {
  const palettes = [
    ["0xF6D365", "0xFDA085"], ["0x84FAB0", "0x8FD3F4"], ["0xA18CD1", "0xFBC2EB"],
    ["0xFAD0C4", "0xFFD1FF"], ["0x89F7FE", "0x66A6FF"], ["0xFDDB92", "0xD1FDFF"],
  ];
  const [c0, c1] = palettes[seed % palettes.length];
  await ffmpeg([
    "-f", "lavfi", "-i", `gradients=s=1080x1920:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=1080:y1=1920:seed=${seed}`,
    "-frames:v", "1", outPath,
  ]);
};

/** SVG'yi PNG'ye çevirir (width: çıktı genişliği, transparent: arka plan boyanmaz) */
export async function svgToPng(svg: string, outPath: string, width = 1080, transparent = false) {
  const { Resvg } = await import("@resvg/resvg-js");
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    ...(transparent ? {} : { background: "#070b16" }),
  }).render().asPng();
  await fs.writeFile(outPath, png);
}

export const LAYERS = ["bg", "mid", "fg"] as const;
export type Layer = (typeof LAYERS)[number];
export const layerPath = (img: string, layer: Layer) => img.replace(/\.png$/, `_${layer}.png`);

/**
 * Katmanlı SVG'den (<g id="bg">, <g id="mid">, <g id="fg">) her katmanı ayrı PNG olarak çıkarır.
 * Video montajında katmanlar farklı hızlarda hareket ettirilerek derinlik (2.5D parallax) verilir.
 * Katman yoksa false döner; sahne tek görsel olarak kullanılır.
 */
export async function renderLayers(svg: string, imgPath: string): Promise<boolean> {
  const has = (id: string) => new RegExp(`<g[^>]*\\bid=["']${id}["']`).test(svg);
  if (!has("bg") || !has("mid")) return false;
  for (const layer of LAYERS) {
    const hide = LAYERS.filter((l) => l !== layer).map((l) => `#${l}`).join(",");
    const variant = svg.replace(/(<svg[^>]*>)/, `$1<style>${hide}{display:none}</style>`);
    // 2x çözünürlük: kamera yakınlaştığında çizgiler keskin kalır
    await svgToPng(variant, layerPath(imgPath, layer), 2160, layer !== "bg");
  }
  return true;
}

/** Claude sahneyi vektör çizim (SVG) olarak çizer; ek anahtar gerekmez */
const claude: ImageProvider = async (prompt, outPath) => {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  const svg = await drawSceneSvg(prompt, s?.contentFormat === "story" ? s.seriesCharacters : undefined);
  await fs.writeFile(outPath.replace(/\.png$/, ".svg"), svg);
  await svgToPng(svg, outPath);
  await renderLayers(svg, outPath);
};

const PROVIDERS: Record<string, ImageProvider> = { fal, replicate, mock, claude };

export async function generateImage(provider: string, prompt: string, outPath: string, seed: number) {
  const fn = PROVIDERS[provider];
  if (!fn) throw new Error(`Bilinmeyen görsel sağlayıcı: ${provider}`);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn(prompt, outPath, seed);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  throw lastErr;
}
