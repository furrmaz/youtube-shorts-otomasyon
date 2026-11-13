import { spawn } from "node:child_process";

export function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} çıkış kodu ${code}: ${err.slice(-1500)}`));
    });
  });
}

export const ffmpeg = (args: string[]) => run(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-y", ...args]);

export async function probeDuration(file: string): Promise<number> {
  const out = await run(process.env.FFPROBE_PATH || "ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  return parseFloat(out.trim());
}
