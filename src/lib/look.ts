// Kanalın görsel dili: renk paleti, kendi fontu, altyazı ve kurgu tercihleri.
// Örnek futbol kanalı videosundan çıkan ders: 4-5 renk ve tek bir font, her videoda aynı dil.
import type { Channel } from "@prisma/client";

const HEX = /^#[0-9a-f]{6}$/i;

/** "#7A1E2C, #F2C14E ..." metnini en fazla 4 geçerli renge çevirir (colorhunt.co'dan kopyalanan biçim de olur) */
export function parsePalette(text: string): string[] {
  const out: string[] = [];
  for (const m of (text || "").matchAll(/#?([0-9a-f]{6})\b/gi)) {
    const c = `#${m[1].toLowerCase()}`;
    if (!out.includes(c)) out.push(c);
    if (out.length === 4) break;
  }
  return out;
}

export type Look = {
  /** Paletin tamamı (boşsa ana + vurgu rengi) */
  palette: string[];
  /** İlerleme çubuğu, vurgu kelimesi, kart rakamları */
  primary: string;
  /** İkinci renk (kart çizgileri, saha) */
  accent: string;
  /** Paletteki en koyu renk (kart zemini) */
  dark: string;
  /** Kullanıcının paleti var mı: varsa çizimlerde de bu renklere sadık kalınır */
  custom: boolean;
  font?: { family: string; dir: string; tracking: number };
  captionMaxChars: number;
  simpleMotion: boolean;
  statCards: boolean;
};

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export function lookOf(c: Channel): Look {
  const custom = parsePalette(c.palette);
  const palette = custom.length ? custom : [c.primaryColor, c.accentColor].filter((x) => HEX.test(x));
  // Vurgu için koyu olmayan ilk renk; zemin için en koyu renk
  const bright = palette.filter((x) => lum(x) > 60);
  const darkest = [...palette].sort((a, b) => lum(a) - lum(b))[0];
  const primary = bright[0] ?? palette[0] ?? "#ffd27a";
  const accent = bright.find((x) => x !== primary) ?? palette.find((x) => x !== primary) ?? primary;
  return {
    palette,
    primary,
    accent,
    dark: darkest && lum(darkest) < 90 ? darkest : "#101418",
    custom: custom.length > 0,
    font: c.fontPath && c.fontFamily ? { family: c.fontFamily, dir: c.fontPath.replace(/[\\/][^\\/]+$/, ""), tracking: c.fontTracking } : undefined,
    captionMaxChars: Math.min(60, Math.max(15, c.captionMaxChars || 35)),
    simpleMotion: c.simpleMotion,
    statCards: c.statCards,
  };
}

/** Görsel istemlerine eklenen renk kuralı */
export function paletteRule(l: Look): string {
  if (!l.custom) return "";
  return `Strict color palette: use ONLY these colors ${l.palette.join(", ")} plus white and their darker/lighter shades; no other hues.`;
}

/**
 * TTF/OTF dosyasının "name" tablosundan font ailesinin adını okur.
 * libass fontu bu adla bulur; dosya adı çoğu zaman farklıdır (ör. Montserrat-Regular.ttf → "Montserrat").
 */
export function fontFamilyOf(buf: Buffer): string | null {
  try {
    const sig = buf.readUInt32BE(0);
    // 0x00010000 TrueType, 'OTTO' CFF, 'true' eski Mac
    if (![0x00010000, 0x4f54544f, 0x74727565].includes(sig)) return null;
    const numTables = buf.readUInt16BE(4);
    let nameOff = -1;
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (buf.toString("latin1", rec, rec + 4) === "name") nameOff = buf.readUInt32BE(rec + 8);
    }
    if (nameOff < 0) return null;
    const count = buf.readUInt16BE(nameOff + 2);
    const strOff = nameOff + buf.readUInt16BE(nameOff + 4);
    const found = new Map<number, string>();
    for (let i = 0; i < count; i++) {
      const r = nameOff + 6 + i * 12;
      const platform = buf.readUInt16BE(r);
      const nameId = buf.readUInt16BE(r + 6);
      const len = buf.readUInt16BE(r + 8);
      const off = strOff + buf.readUInt16BE(r + 10);
      if (nameId !== 1 && nameId !== 16) continue;
      let text = "";
      if (platform === 3 || platform === 0) {
        for (let j = 0; j + 1 < len; j += 2) text += String.fromCharCode(buf.readUInt16BE(off + j));
      } else if (platform === 1) {
        text = buf.toString("latin1", off, off + len);
      } else continue;
      // Windows (3) kaydı önceliklidir
      if (text.trim() && (!found.has(nameId) || platform === 3)) found.set(nameId, text.trim());
    }
    return found.get(1) ?? found.get(16) ?? null;
  } catch {
    return null;
  }
}
