// Paneli ve zamanlayıcıyı tek komutla birlikte başlatır: `npm run baslat`
import { spawn, execSync } from "node:child_process";
import net from "node:net";

const PORT = Number(process.env.PORT || 3000);
const isWin = process.platform === "win32";

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port);
  });
}

if (!(await portFree(PORT))) {
  console.error(`\n${PORT} numaralı port kullanımda. Uygulama büyük ihtimalle başka bir pencerede zaten çalışıyor.`);
  console.error(`- Tarayıcıda http://localhost:${PORT} adresini açmayı deneyin, ya da`);
  console.error(isWin ? "- Eski süreci kapatın:  taskkill /IM node.exe /F   ve tekrar  npm run baslat" : `- Eski süreci kapatın:  npx kill-port ${PORT}`);
  process.exit(1);
}

const procs = [
  ["panel", `npx next start -p ${PORT}`],
  ["worker", "npx tsx --env-file=.env scripts/worker.ts"],
];

// Windows'ta kabuk üzerinden başlatılan alt süreçler ağaç olarak kapatılmalı
function killTree(p) {
  if (!p.pid || p.exitCode !== null) return;
  try {
    if (isWin) execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-p.pid, "SIGTERM"); // tüm süreç grubu
  } catch {
    /* zaten kapanmış */
  }
}

let stopping = false;
const children = procs.map(([name, cmd]) => {
  const p = spawn(cmd, { shell: true, stdio: ["ignore", "pipe", "pipe"], detached: !isWin });
  const prefix = (d) => d.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join("\n") + "\n";
  p.stdout.on("data", (d) => process.stdout.write(prefix(d)));
  p.stderr.on("data", (d) => process.stderr.write(prefix(d)));
  p.on("exit", (code) => {
    if (stopping) return;
    console.log(`[${name}] kapandı (kod ${code}), diğer süreç de durduruluyor`);
    stop(code ?? 1);
  });
  return p;
});

function stop(code = 0) {
  stopping = true;
  children.forEach(killTree);
  process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
process.on("SIGHUP", () => stop(0));
console.log(`Panel: http://localhost:${PORT}  (kapatmak için Ctrl+C)`);
