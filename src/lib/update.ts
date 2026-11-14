import { execFile } from "node:child_process";

const run = (args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile("git", args, { timeout: 10_000, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(out.trim()))),
  );

const g = globalThis as unknown as { __updateCheck?: { at: number; available: boolean } };

/** GitHub'da daha yeni bir sürüm var mı? (6 saatte bir kontrol edilir, hata olursa sessizce false) */
export async function updateAvailable(): Promise<boolean> {
  const c = g.__updateCheck;
  if (c && Date.now() - c.at < 6 * 3600_000) return c.available;
  let available = false;
  try {
    const local = await run(["rev-parse", "HEAD"]);
    const remote = (await run(["ls-remote", "origin", "refs/heads/main"])).split(/\s+/)[0];
    if (remote && remote !== local) {
      // Yerel sürüm uzaktakini zaten içeriyorsa (ör. yerel değişiklik) uyarma
      available = !(await run(["merge-base", "--is-ancestor", remote, "HEAD"]).then(() => true, () => false));
    }
  } catch {
    available = false;
  }
  g.__updateCheck = { at: Date.now(), available };
  return available;
}
