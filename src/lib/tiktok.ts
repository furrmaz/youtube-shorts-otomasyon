import fs from "node:fs/promises";
import { prisma } from "./db";
import { cfg } from "./config";
import { getSettings } from "./settings";

const API = "https://open.tiktokapis.com/v2";
const SCOPES = "user.info.basic,video.publish,video.upload";

async function app() {
  const s = await getSettings();
  const c = await cfg();
  const key = s.tiktokClientKey.trim();
  const secret = s.tiktokClientSecret.trim();
  if (!key || !secret) throw new Error("TikTok Client Key / Secret girilmemiş (Ayarlar → Sosyal medya)");
  return { key, secret, redirect: s.tiktokRedirectUri.trim() || `${c.appUrl}/api/tiktok/callback` };
}

export async function tiktokAuthUrl(state: string) {
  const a = await app();
  const q = new URLSearchParams({ client_key: a.key, scope: SCOPES, response_type: "code", redirect_uri: a.redirect, state });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}

type TokenRes = {
  access_token: string; expires_in: number; open_id: string; refresh_token: string; scope: string;
  error?: string; error_description?: string;
};

async function token(body: Record<string, string>): Promise<TokenRes> {
  const r = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const j = (await r.json()) as TokenRes;
  if (!r.ok || j.error || !j.access_token) throw new Error(`TikTok token hatası: ${j.error_description || j.error || r.status}`);
  return j;
}

/** Yetkilendirme kodunu (veya kodu içeren dönüş adresini) kanala TikTok bağlantısı olarak kaydeder */
export async function tiktokConnect(channelId: string, codeOrUrl: string) {
  const a = await app();
  let code = codeOrUrl.trim();
  if (code.includes("code=")) code = new URL(code.startsWith("http") ? code : `https://x/?${code.split("?").pop()}`).searchParams.get("code") ?? "";
  if (!code) throw new Error("Dönüş adresinde 'code' bulunamadı");
  const t = await token({ client_key: a.key, client_secret: a.secret, code, grant_type: "authorization_code", redirect_uri: a.redirect });
  let name = t.open_id;
  try {
    const u = await fetch(`${API}/user/info/?fields=open_id,display_name`, { headers: { Authorization: `Bearer ${t.access_token}` } });
    const j = (await u.json()) as { data?: { user?: { display_name?: string } } };
    name = j.data?.user?.display_name || name;
  } catch {
    /* isim alınamazsa open_id kullanılır */
  }
  const data = {
    accountId: t.open_id, accountName: name, accessToken: t.access_token, refreshToken: t.refresh_token,
    expiresAt: new Date(Date.now() + t.expires_in * 1000), extra: JSON.stringify({ scope: t.scope }),
  };
  await prisma.connection.upsert({
    where: { channelId_platform: { channelId, platform: "tiktok" } },
    update: data,
    create: { channelId, platform: "tiktok", ...data },
  });
  return name;
}

async function accessToken(channelId: string) {
  const c = await prisma.connection.findUnique({ where: { channelId_platform: { channelId, platform: "tiktok" } } });
  if (!c) throw new Error("Bu kanala TikTok hesabı bağlı değil");
  if (c.expiresAt && c.expiresAt.getTime() > Date.now() + 5 * 60_000) return c.accessToken;
  const a = await app();
  const t = await token({ client_key: a.key, client_secret: a.secret, grant_type: "refresh_token", refresh_token: c.refreshToken });
  await prisma.connection.update({
    where: { id: c.id },
    data: { accessToken: t.access_token, refreshToken: t.refresh_token || c.refreshToken, expiresAt: new Date(Date.now() + t.expires_in * 1000) },
  });
  return t.access_token;
}

async function post<T>(path: string, tok: string, body: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as { data: T; error?: { code: string; message: string } };
  if (j.error && j.error.code !== "ok") {
    const hint =
      j.error.code === "unaudited_client_can_only_post_to_private_accounts"
        ? " (TikTok uygulamanız henüz denetlenmedi: doğrudan paylaşım için TikTok hesabını gizli yapın ya da kanal ayarında 'Taslak olarak gönder'i seçin)"
        : "";
    throw new Error(`TikTok: ${j.error.code} ${j.error.message}${hint}`);
  }
  return j.data;
}

/**
 * Videoyu TikTok'a gönderir.
 * - draft: TikTok uygulamasında bildirim olarak gelir, kullanıcı açıklamayı kontrol edip paylaşır (denetimsiz uygulamalarda da çalışır)
 * - direct: doğrudan paylaşır (TikTok denetiminden geçmiş uygulama gerekir)
 */
export async function uploadTiktok(opts: { channelId: string; filePath: string; caption: string; mode: string }) {
  const tok = await accessToken(opts.channelId);
  const buf = await fs.readFile(opts.filePath);
  const size = buf.length;
  if (size > 64 * 1024 * 1024) throw new Error("TikTok: video 64 MB'tan büyük");
  const source_info = { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 };
  let init: { publish_id: string; upload_url: string };
  if (opts.mode === "direct") {
    const info = await post<{ privacy_level_options: string[] }>("/post/publish/creator_info/query/", tok, {});
    const opt = info.privacy_level_options ?? [];
    const privacy = opt.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : opt[0] ?? "SELF_ONLY";
    init = await post("/post/publish/video/init/", tok, {
      post_info: { title: opts.caption.slice(0, 2100), privacy_level: privacy, is_aigc: true, brand_organic_toggle: true },
      source_info,
    });
  } else {
    init = await post("/post/publish/inbox/video/init/", tok, { source_info });
  }
  const put = await fetch(init.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Content-Range": `bytes 0-${size - 1}/${size}` },
    body: buf,
  });
  if (!put.ok) throw new Error(`TikTok yükleme hatası ${put.status}: ${(await put.text()).slice(0, 200)}`);
  // Durumu izle (en fazla ~3 dk)
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await post<{ status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>(
      "/post/publish/status/fetch/", tok, { publish_id: init.publish_id },
    );
    if (st.status === "FAILED") throw new Error(`TikTok işleme hatası: ${st.fail_reason ?? "bilinmiyor"}`);
    if (st.status === "PUBLISH_COMPLETE") return String(st.publicaly_available_post_id?.[0] ?? init.publish_id);
    if (st.status === "SEND_TO_USER_INBOX") return `taslak:${init.publish_id}`;
  }
  return `isleniyor:${init.publish_id}`;
}
