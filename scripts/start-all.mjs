// Paneli ve zamanlayıcıyı tek komutla birlikte başlatır: `npm run baslat`
import { spawn } from "node:child_process";

const procs = [
  ["panel", "npx next start -p " + (process.env.PORT || 3000)],
  ["worker", "npx tsx --env-file=.env scripts/worker.ts"],
];

const children = procs.map(([name, cmd]) => {
  const p = spawn(cmd, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = (d) => d.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join("\n") + "\n";
  p.stdout.on("data", (d) => process.stdout.write(prefix(d)));
  p.stderr.on("data", (d) => process.stderr.write(prefix(d)));
  p.on("exit", (code) => {
    console.log(`[${name}] kapandı (kod ${code}), diğer süreç de durduruluyor`);
    children.forEach((c) => c.kill());
    process.exit(code ?? 1);
  });
  return p;
});

const stop = () => { children.forEach((c) => c.kill()); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
console.log(`Panel: http://localhost:${process.env.PORT || 3000}  (kapatmak için Ctrl+C)`);
