import fs from "node:fs/promises";
import { prisma } from "./db";
import { getSettings } from "./settings";

const V = "v21.0";
const GRAPH = `https://graph.facebook.com/${V}`;

async function gget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j = (await r.json()) as T & { error?: { message: string } };
  if (!r.ok || j.error) throw new Error(`Instagram: ${j.error?.message ?? r.status}`);
  return j;
}

/**
 * Instagram bağlantısı: Meta Graph API Explorer'dan alınan kullanıcı erişim anahtarı yapıştırılır.
 * Meta uygulama kimliği/sırrı girilmişse anahtar uzun ömürlüye çevrilir; Facebook sayfasına bağlı
 * Instagram işletme hesabı bulunur ve süresiz sayfa anahtarı saklanır.
 */
export async function instagramConnect(channelId: string, userToken: string, wantedUsername = "") {
  const s = await getSettings();
  let tok = userToken.trim();
  if (!tok) throw new Error("Erişim anahtarı boş");
  if (s.metaAppId.trim() && s.metaAppSecret.trim()) {
    const q = new URLSearchParams({
      grant_type: "fb_exchange_token", client_id: s.metaAppId.trim(), client_secret: s.metaAppSecret.trim(), fb_exchange_token: tok,
    });
    const j = await gget<{ access_token: string }>(`${GRAPH}/oauth/access_token?${q}`);
    tok = j.access_token;
  }
  const pages = await gget<{
    data: { name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[];
  }>(`${GRAPH}/me/accounts?fields=name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(tok)}`);
  const withIg = pages.data.filter((p) => p.instagram_business_account);
  const page =
    withIg.find((p) => wantedUsername && p.instagram_business_account?.username?.toLowerCase() === wantedUsername.replace(/^@/, "").toLowerCase()) ??
    withIg[0];
  if (!page) throw new Error("Bu hesaba bağlı Facebook sayfasında Instagram işletme/üretici hesabı bulunamadı");
  const ig = page.instagram_business_account!;
  const data = {
    accountId: ig.id, accountName: ig.username ?? page.name, accessToken: page.access_token, refreshToken: "",
    expiresAt: null, extra: JSON.stringify({ page: page.name }),
  };
  await prisma.connection.upsert({
    where: { channelId_platform: { channelId, platform: "instagram" } },
    update: data,
    create: { channelId, platform: "instagram", ...data },
  });
  return data.accountName;
}

/** Videoyu Instagram Reels olarak yayınlar (dosya doğrudan yüklenir, herkese açık adres gerekmez) */
export async function uploadReel(opts: { channelId: string; filePath: string; caption: string }) {
  const c = await prisma.connection.findUnique({ where: { channelId_platform: { channelId: opts.channelId, platform: "instagram" } } });
  if (!c) throw new Error("Bu kanala Instagram hesabı bağlı değil");
  const auth = { Authorization: `OAuth ${c.accessToken}` };
  const create = await fetch(`${GRAPH}/${c.accountId}/media`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ media_type: "REELS", upload_type: "resumable", caption: opts.caption.slice(0, 2100), share_to_feed: true }),
  });
  const cj = (await create.json()) as { id?: string; uri?: string; error?: { message: string } };
  if (!create.ok || !cj.id) throw new Error(`Instagram kapsayıcı hatası: ${cj.error?.message ?? create.status}`);
  const buf = await fs.readFile(opts.filePath);
  const up = await fetch(cj.uri ?? `https://rupload.facebook.com/ig-api-upload/${V}/${cj.id}`, {
    method: "POST",
    headers: { ...auth, offset: "0", file_size: String(buf.length) },
    body: buf,
  });
  if (!up.ok) throw new Error(`Instagram yükleme hatası ${up.status}: ${(await up.text()).slice(0, 200)}`);
  // İşlenmesini bekle (en fazla ~5 dk)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const st = await fetch(`${GRAPH}/${cj.id}?fields=status_code,status`, { headers: auth });
    const sj = (await st.json()) as { status_code?: string; status?: string };
    if (sj.status_code === "ERROR" || sj.status_code === "EXPIRED") throw new Error(`Instagram işleme hatası: ${sj.status ?? sj.status_code}`);
    if (sj.status_code === "FINISHED") {
      const pub = await fetch(`${GRAPH}/${c.accountId}/media_publish`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ creation_id: cj.id }),
      });
      const pj = (await pub.json()) as { id?: string; error?: { message: string } };
      if (!pub.ok || !pj.id) throw new Error(`Instagram yayınlama hatası: ${pj.error?.message ?? pub.status}`);
      return pj.id;
    }
  }
  throw new Error("Instagram videoyu 5 dakikada işleyemedi; daha sonra tekrar deneyin");
}
