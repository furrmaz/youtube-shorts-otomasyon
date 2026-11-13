import path from "node:path";
import fs from "node:fs/promises";

export const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR || "./media");

export async function itemDir(itemId: string) {
  const dir = path.join(MEDIA_DIR, itemId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
