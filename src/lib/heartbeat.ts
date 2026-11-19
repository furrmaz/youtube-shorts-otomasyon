import fs from "node:fs/promises";
import path from "node:path";
import { MEDIA_DIR } from "./paths";

// Zamanlayıcı (worker) her turda bu dosyaya saat yazar; /api/health çalışıp çalışmadığını buradan anlar
const FILE = path.join(MEDIA_DIR, ".worker-heartbeat");

export async function beat() {
  try {
    await fs.mkdir(MEDIA_DIR, { recursive: true });
    await fs.writeFile(FILE, new Date().toISOString());
  } catch {
    /* kalp atışı yazılamazsa zamanlayıcıyı durdurma */
  }
}

/** Son kalp atışından bu yana geçen saniye (hiç yoksa null) */
export async function lastBeatAgo(): Promise<number | null> {
  try {
    const t = Date.parse(await fs.readFile(FILE, "utf8"));
    return Number.isFinite(t) ? Math.round((Date.now() - t) / 1000) : null;
  } catch {
    return null;
  }
}
