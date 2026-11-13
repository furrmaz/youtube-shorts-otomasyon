"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import fs from "node:fs/promises";
import { prisma } from "@/lib/db";
import { generateCalendar, produceItem, uploadItem } from "@/lib/pipeline";
import { itemDir } from "@/lib/paths";
import { getSettings } from "@/lib/settings";
import { zonedToUtc } from "@/lib/time";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveSettings(f: FormData) {
  const data = {
    niche: str(f, "niche"),
    language: str(f, "language") || "tr",
    channelStyle: str(f, "channelStyle"),
    visualStyle: str(f, "visualStyle"),
    elevenVoiceId: str(f, "elevenVoiceId"),
    videosPerDay: Math.min(5, Math.max(1, Number(str(f, "videosPerDay")) || 1)),
    publishTimes: str(f, "publishTimes") || "18:00",
    timezone: str(f, "timezone") || "Europe/Istanbul",
    privacyStatus: str(f, "privacyStatus") || "public",
    imageProvider: str(f, "imageProvider") || "mock",
    ttsProvider: str(f, "ttsProvider") || "mock",
    autoProduce: f.get("autoProduce") === "on",
    produceHoursAhead: Math.max(1, Number(str(f, "produceHoursAhead")) || 6),
  };
  await prisma.settings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  revalidatePath("/", "layout");
  redirect("/settings?saved=1");
}

export async function startCalendar(f: FormData) {
  const days = Math.min(60, Math.max(1, Number(str(f, "days")) || 30));
  // Uzun sürer (birkaç dakika): arka planda çalıştır, sayfa durumu gösterir
  void generateCalendar(days);
  await new Promise((r) => setTimeout(r, 300));
  revalidatePath("/calendar");
}

export async function saveItem(f: FormData) {
  const id = str(f, "id");
  const tags = str(f, "tags").split(",").map((t) => t.trim()).filter(Boolean);
  const item = await prisma.contentItem.findUniqueOrThrow({ where: { id } });
  const scriptChanged = item.script !== str(f, "script");
  await prisma.contentItem.update({
    where: { id },
    data: {
      topic: str(f, "topic"),
      hook: str(f, "hook"),
      script: str(f, "script"),
      title: str(f, "title"),
      description: str(f, "description"),
      tags: JSON.stringify(tags),
      ...(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str(f, "publishAt"))
        ? { publishAt: zonedToUtc(str(f, "publishAt").slice(0, 10), str(f, "publishAt").slice(11, 16), (await getSettings()).timezone) }
        : {}),
      // Metin değiştiyse eski ses/sahne planı geçersiz
      ...(scriptChanged ? { scenes: null, status: item.status === "UPLOADED" ? item.status : "DRAFT" } : {}),
    },
  });
  if (scriptChanged) await clearMedia(id);
  revalidatePath("/calendar");
  revalidatePath(`/items/${id}`);
}

async function clearMedia(id: string) {
  const dir = await itemDir(id);
  await fs.rm(dir, { recursive: true, force: true });
}

export async function setStatus(f: FormData) {
  const id = str(f, "id");
  const status = str(f, "status");
  if (!["DRAFT", "APPROVED"].includes(status)) return;
  await prisma.contentItem.updateMany({
    where: { id, status: { in: ["DRAFT", "APPROVED", "FAILED"] } },
    data: { status, error: null },
  });
  revalidatePath("/calendar");
  revalidatePath(`/items/${id}`);
}

export async function approveAll() {
  await prisma.contentItem.updateMany({ where: { status: "DRAFT" }, data: { status: "APPROVED" } });
  revalidatePath("/calendar");
}

export async function deleteItem(f: FormData) {
  const id = str(f, "id");
  await prisma.contentItem.deleteMany({ where: { id, status: { not: "UPLOADED" } } });
  await clearMedia(id);
  revalidatePath("/calendar");
}

export async function produceNow(f: FormData) {
  const id = str(f, "id");
  await prisma.contentItem.updateMany({ where: { id, status: "DRAFT" }, data: { status: "APPROVED" } });
  void produceItem(id);
  await new Promise((r) => setTimeout(r, 300));
  revalidatePath(`/items/${id}`);
}

export async function regenerateMedia(f: FormData) {
  const id = str(f, "id");
  await clearMedia(id);
  await prisma.contentItem.updateMany({
    where: { id, status: { in: ["READY", "FAILED"] } },
    data: { scenes: null, videoPath: null, audioPath: null, status: "APPROVED", error: null },
  });
  void produceItem(id);
  await new Promise((r) => setTimeout(r, 300));
  revalidatePath(`/items/${id}`);
}

export async function uploadNow(f: FormData) {
  const id = str(f, "id");
  await prisma.contentItem.updateMany({ where: { id, status: "READY" }, data: { error: null } });
  void uploadItem(id);
  await new Promise((r) => setTimeout(r, 300));
  revalidatePath(`/items/${id}`);
}

export async function disconnectYoutube() {
  await prisma.youtubeAccount.deleteMany({});
  revalidatePath("/");
}
