// Anahtarsız uçtan uca deneme: örnek bir içerik oluşturup mock sağlayıcılarla videoya çevirir.
// Kullanım: npm run demo
import { prisma } from "../src/lib/db";
import { produceItem } from "../src/lib/pipeline";
import fs from "node:fs/promises";
import path from "node:path";
import { itemDir } from "../src/lib/paths";

async function story() {
  const script =
    "Saat on biri kırk üç geçiyor. Kuzey çevre yolundasın ve önündeki kırmızı stop lambaları kilometrelerce uzanıyor. " +
    "Telefonun haritası kıpkırmızı. Radyoyu açıyorsun, sadece cızırtı var. Sonra bir ses: trafik yoğunluğu nedeniyle lütfen araçlarınızdan inmeyin. " +
    "Dikiz aynasına bakıyorsun. Arkandaki aracın farları sönük ama içinde biri var, seni izliyor. " +
    "Birden camına iki kez vuruluyor. Dışarıda tanımadığın bir adam, bir şey söylemek istiyor. " +
    "Ne yaparsın? A: camı açıp dinler misin, yoksa B: sessiz kalıp bekler misin? Kararını yorumlara yaz.";
  const item = await prisma.contentItem.create({
    data: {
      dayIndex: 1, episodeNumber: 1, publishAt: new Date(Date.now() + 86400_000),
      topic: "Kontağı Kapat", hook: "Saat on biri kırk üç geçiyor.", script,
      title: "Son Şerit - Bölüm 1: Kontağı Kapat", description: "Yorumlara A veya B yaz!",
      tags: "[]", status: "APPROVED", autoUpload: false,
      choiceA: "Camı aç ve dinle", choiceB: "Sessiz kal ve bekle",
      scenes: JSON.stringify(script.split(/(?<=[.?!:])\s+/).map((t) => ({ text: t, imagePrompt: "demo", start: 0, end: 0 }))),
    },
  });
  await prisma.settings.update({ where: { id: 1 }, data: { seriesTitle: "Son Şerit", subtitleStyle: "minimal", watermark: "@kanaladi" } });
  await produceItem(item.id);
  const done = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
  console.log("Durum:", done.status, done.error ?? "", done.videoPath ?? "");
  await prisma.$disconnect();
}

async function main() {
  if (process.argv.includes("story")) return story();
  const script =
    "Ahtapotların üç kalbi olduğunu biliyor muydun? İkisi kanı solungaçlara pompalar, üçüncüsü ise vücudun geri kalanına. " +
    "Üstelik kanları kırmızı değil, mavidir. Bunun sebebi oksijeni taşıyan molekülün demir yerine bakır içermesidir. " +
    "Ahtapot yüzerken ana kalbi durur, bu yüzden yüzmek yerine sürünmeyi tercih eder. Sence okyanusun en zeki canlısı hangisi?";
  const item = await prisma.contentItem.create({
    data: {
      dayIndex: 0,
      publishAt: new Date(Date.now() + 86400_000),
      topic: "Ahtapotun üç kalbi",
      hook: "Ahtapotların üç kalbi olduğunu biliyor muydun?",
      script,
      title: "Ahtapotun 3 kalbi var!",
      description: "Ahtapotlar hakkında şaşırtıcı bir bilgi. #ahtapot #bilim",
      tags: JSON.stringify(["ahtapot", "bilim"]),
      status: "APPROVED",
      autoUpload: false,
      // Claude'suz deneme için hazır sahne planı
      scenes: JSON.stringify(
        script.split(/(?<=[.?!])\s+/).map((t) => ({ text: t, imagePrompt: "demo", start: 0, end: 0 })),
      ),
    },
  });
  await itemDir(item.id);
  await produceItem(item.id);
  const done = await prisma.contentItem.findUniqueOrThrow({ where: { id: item.id } });
  console.log("Durum:", done.status, done.error ?? "");
  if (done.videoPath) {
    const st = await fs.stat(done.videoPath);
    console.log("Video:", path.relative(process.cwd(), done.videoPath), `${(st.size / 1e6).toFixed(1)} MB`);
  }
  await prisma.$disconnect();
}
main();
