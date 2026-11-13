// Zamanlayıcı: panelden ayrı, sürekli çalışan süreç. `npm run worker`
import { tick } from "../src/lib/pipeline";

const INTERVAL = Number(process.env.WORKER_INTERVAL_SEC || 60) * 1000;
let running = false;

async function loop() {
  if (running) return;
  running = true;
  try {
    await tick();
  } catch (e) {
    console.error("[worker] tur hatası:", e);
  } finally {
    running = false;
  }
}

console.log(`[worker] başladı, her ${INTERVAL / 1000} sn kontrol ediliyor`);
loop();
setInterval(loop, INTERVAL);
