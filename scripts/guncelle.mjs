// Uygulamayı GitHub'daki son sürüme günceller: `npm run guncelle` veya Guncelle.bat
import { spawnSync } from "node:child_process";

const steps = [
  ["Yerel paket kilidi sıfırlanıyor", "git checkout -- package-lock.json"],
  ["Son sürüm indiriliyor", "git pull --ff-only origin main"],
  ["Paketler kuruluyor", "npm install --no-audit --no-fund"],
  ["Veritabanı güncelleniyor", "npx prisma db push"],
  ["Panel derleniyor", "npx next build"],
];

for (const [title, cmd] of steps) {
  console.log(`\n=== ${title} ===\n> ${cmd}`);
  const r = spawnSync(cmd, { shell: true, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\n✗ "${title}" adımı başarısız oldu (kod ${r.status}).`);
    if (cmd.startsWith("git pull"))
      console.error("  Yerelde değiştirdiğiniz dosyalar olabilir. Hata mesajını kopyalayıp Claude'a gönderin.");
    if (cmd.includes("prisma") || cmd.includes("next build"))
      console.error("  Uygulama açıksa önce kapatın (Ctrl+C veya Guncelle.bat), sonra tekrar deneyin.");
    process.exit(r.status ?? 1);
  }
}
console.log("\n✓ Güncelleme tamamlandı. Başlatmak için Baslat.bat'a çift tıklayın (veya npm run baslat).");
