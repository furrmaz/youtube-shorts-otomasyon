import { prisma } from "./db";

export async function log(message: string, opts: { itemId?: string; level?: "info" | "warn" | "error" } = {}) {
  const level = opts.level ?? "info";
  console[level === "error" ? "error" : "log"](`[${level}]${opts.itemId ? ` [${opts.itemId}]` : ""} ${message}`);
  try {
    await prisma.jobLog.create({ data: { message: message.slice(0, 2000), level, itemId: opts.itemId } });
  } catch {
    /* log yazılamazsa akışı durdurma */
  }
}
