import { spawn } from "node:child_process";

export type RunOpts = {
  /** ffmpeg'in "time=" çıktısından okunan işlenmiş süre (sn) */
  onTime?: (sec: number) => void;
  /** Bu kadar süre hiç çıktı gelmezse süreç takılmış sayılıp durdurulur */
  stallMs?: number;
};

export function run(cmd: string, args: string[], opts: RunOpts = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let stalled = false;
    let timer: NodeJS.Timeout | undefined;
    const arm = () => {
      if (!opts.stallMs) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        p.kill("SIGKILL");
      }, opts.stallMs);
    };
    arm();
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => {
      const s = String(d);
      // ilerleme satırları sürekli geldiği için sadece son kısmı tut
      err = (err + s).slice(-8000);
      arm();
      const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
      if (m && opts.onTime) opts.onTime(+m[1] * 3600 + +m[2] * 60 + +m[3]);
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else if (stalled) reject(new Error(`${cmd} ${Math.round(opts.stallMs! / 60000)} dakikadır ilerlemedi, durduruldu: ${err.slice(-800)}`));
      else reject(new Error(`${cmd} çıkış kodu ${code}: ${err.slice(-1500)}`));
    });
  });
}

/** Varsayılan: 10 dk hiç çıktı vermeyen ffmpeg takılmış sayılır */
export const ffmpeg = (args: string[], opts: RunOpts = {}) =>
  run(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-y", ...args], { stallMs: 10 * 60_000, ...opts });

export async function probeDuration(file: string): Promise<number> {
  const out = await run(process.env.FFPROBE_PATH || "ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  return parseFloat(out.trim());
}
