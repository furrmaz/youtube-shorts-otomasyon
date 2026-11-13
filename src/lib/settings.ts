import { prisma } from "./db";

export async function getSettings() {
  return prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}
export type AppSettings = Awaited<ReturnType<typeof getSettings>>;
