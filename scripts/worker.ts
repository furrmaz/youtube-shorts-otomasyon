// Zamanlayıcı: panelden ayrı, sürekli çalışan süreç. `npm run worker`
import { tick } from "../src/lib/pipeline";
import { beat } from "../src/lib/heartbeat";

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
// Süreç ayakta olduğu sürece 30 sn'de bir kalp atışı (uzun video üretimi sırasında da)
beat();
setInterval(beat, 30_000);
