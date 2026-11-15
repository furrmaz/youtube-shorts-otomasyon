import { getSettings } from "@/lib/settings";
import { cfg, mask } from "@/lib/config";
import Link from "next/link";
import { saveKeys, saveSettings, testKeys } from "@/app/actions";
import { currentChannel } from "@/lib/current-channel";

export const dynamic = "force-dynamic";

function Secret({ name, label, value, help }: { name: string; label: string; value: string; help?: React.ReactNode }) {
  return (
    <div>
      <label>{label}</label>
      <input type="password" name={name} placeholder={value ? mask(value) : "girilmedi"} autoComplete="off" />
      <div className="row muted" style={{ gap: 12 }}>
        {help}
        {value && (
          <label style={{ display: "inline-flex", gap: 4, margin: 0 }}>
            <input type="checkbox" name={`clear_${name}`} style={{ width: "auto" }} /> kaldır
          </label>
        )}
      </div>
    </div>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; test?: string }> }) {
  const s = await getSettings();
  const c = await cfg();
  const ch = await currentChannel();
  const { saved, test } = await searchParams;
  const tests: Record<string, string> | null = test ? JSON.parse(test) : null;

  return (
    <>
      <h1>Ayarlar</h1>
      {saved && <div className="card">Kaydedildi ✓</div>}

      <div className="card">
        Konu, ses, renk, logo, yayın saatleri ve hesap bağlantıları artık her kanalda ayrı:{" "}
        <Link href={`/channels/${ch.id}`}>{ch.name} kanal ayarları</Link> · <Link href="/channels">tüm kanallar</Link>
      </div>

      <form action={saveSettings} className="card">
        <h2 style={{ marginTop: 0 }}>Üretim (tüm kanallar)</h2>
        <div className="two">
          <div>
            <label>Seslendirme</label>
            <select name="ttsProvider" defaultValue={s.ttsProvider}>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="mock">Deneme (sessiz, anahtar gerekmez)</option>
            </select>
          </div>
          <div>
            <label>Görsel sağlayıcı</label>
            <select name="imageProvider" defaultValue={s.imageProvider}>
              <option value="claude">Claude çizimi (katmanlı vektör, 2.5D hareket, ek anahtar gerekmez)</option>
              <option value="fal">fal.ai (Flux)</option>
              <option value="replicate">Replicate (Flux)</option>
              <option value="mock">Deneme (degrade, anahtar gerekmez)</option>
            </select>
          </div>
          <div>
            <label>Saat dilimi</label>
            <input name="timezone" defaultValue={s.timezone} />
          </div>
          <div>
            <label>Yayından kaç saat önce üretilsin</label>
            <input type="number" min={1} name="produceHoursAhead" defaultValue={s.produceHoursAhead} />
          </div>
        </div>

        <h2>Müzik ve efektler</h2>
        <div className="two">
          <div>
            <label>Arka plan müziği</label>
            <select name="musicSource" defaultValue={s.musicSource}>
              <option value="folder">music klasöründeki parçalar</option>
              <option value="eleven">ElevenLabs ile üret (ücretli plan gerekir)</option>
              <option value="off">Müzik yok</option>
            </select>
            <div className="muted">
              ElevenLabs seçilirse kanalın müzik tarifine göre telifsiz parçalar üretilip <code>music</code> klasörüne kaydedilir, sonra dönüşümlü kullanılır.
            </div>
          </div>
          <div>
            <label>Müzik seviyesi (0.12 önerilir)</label>
            <input name="musicVolume" type="number" step="0.01" min={0} max={1} defaultValue={s.musicVolume} />
            <div className="muted">Konuşma sırasında müzik otomatik olarak kısılır.</div>
          </div>
        </div>
        <div className="checks">
          <label><input type="checkbox" name="sfx" defaultChecked={s.sfx} /> Sahne geçişlerinde hafif geçiş sesi</label>
          <label><input type="checkbox" name="particles" defaultChecked={s.particles} /> Havada süzülen ışık parçacıkları</label>
          <label><input type="checkbox" name="progressBar" defaultChecked={s.progressBar} /> Üstte ilerleme çubuğu (kanal renginde)</label>
          <label><input type="checkbox" name="hookText" defaultChecked={s.hookText} /> İlk saniyelerde büyük başlık</label>
        </div>
        <div style={{ marginTop: 16 }}>
          <button>Kaydet</button>
        </div>
      </form>

      <form action={saveKeys} className="card" id="anahtarlar">
        <h2 style={{ marginTop: 0 }}>API anahtarları</h2>
        <p className="muted">
          Anahtarlar sadece bu bilgisayardaki veritabanında saklanır. Kayıtlı bir anahtarı değiştirmek için yenisini yazın; boş bırakırsanız eskisi korunur.
        </p>
        {tests && (
          <div className="card" style={{ background: "#0c0e12" }}>
            {Object.entries(tests).map(([k, v]) => (
              <div key={k} className={v.startsWith("✓") ? "" : "err"}>
                <b>{k}:</b> {v}
              </div>
            ))}
          </div>
        )}
        <div className="two">
          <Secret name="anthropicApiKey" label="Claude API anahtarı" value={c.anthropicApiKey}
            help={<a href="https://console.anthropic.com/settings/keys" target="_blank">anahtar al</a>} />
          <div>
            <label>Claude modeli</label>
            <input name="claudeModel" defaultValue={s.claudeModel} placeholder={c.claudeModel} />
          </div>
          <Secret name="elevenApiKey" label="ElevenLabs API anahtarı" value={c.elevenApiKey}
            help={<a href="https://elevenlabs.io/app/settings/api-keys" target="_blank">anahtar al</a>} />
          <div>
            <label>ElevenLabs modeli</label>
            <input name="elevenModelId" defaultValue={s.elevenModelId} placeholder={c.elevenModelId} />
          </div>
          <Secret name="falKey" label="fal.ai anahtarı" value={c.falKey}
            help={<a href="https://fal.ai/dashboard/keys" target="_blank">anahtar al</a>} />
          <div>
            <label>fal.ai modeli</label>
            <input name="falModel" defaultValue={s.falModel} placeholder={c.falModel} />
          </div>
          <Secret name="replicateToken" label="Replicate anahtarı" value={c.replicateToken}
            help={<a href="https://replicate.com/account/api-tokens" target="_blank">anahtar al</a>} />
          <div>
            <label>Replicate modeli</label>
            <input name="replicateModel" defaultValue={s.replicateModel} placeholder={c.replicateModel} />
          </div>
        </div>

        <h2>YouTube (Google OAuth)</h2>
        <p className="muted">
          Google Cloud Console → YouTube Data API v3&apos;ü açın → OAuth istemcisi (Web application) oluşturun. Yönlendirme adresi olarak şunu ekleyin:{" "}
          <code>{c.appUrl}/api/youtube/callback</code>
        </p>
        <div className="two">
          <div>
            <label>Google Client ID</label>
            <input name="googleClientId" defaultValue={s.googleClientId} placeholder={c.googleClientId || "….apps.googleusercontent.com"} />
          </div>
          <Secret name="googleClientSecret" label="Google Client Secret" value={c.googleClientSecret} />
          <div>
            <label>Uygulama adresi</label>
            <input name="appUrl" defaultValue={s.appUrl} placeholder={c.appUrl} />
          </div>
        </div>

        <h2 id="sosyal">Sosyal medya: TikTok</h2>
        <ol className="steps">
          <li><a href="https://developers.tiktok.com/" target="_blank">developers.tiktok.com</a>&apos;da giriş yapıp <b>Manage apps → Connect an app</b> ile uygulama oluşturun.</li>
          <li><b>Products</b> kısmına <b>Login Kit</b> ve <b>Content Posting API</b> ekleyin; Content Posting API&apos;de <b>Direct Post</b>&apos;u açın. İzinler: <code>user.info.basic</code> <code>video.upload</code> <code>video.publish</code>.</li>
          <li>
            Login Kit → <b>Redirect URI</b>: TikTok sadece <code>https</code> kabul eder. Bilgisayarınızda çalıştığı için şunu yazın:{" "}
            <code>https://localhost/tiktok-donus</code> ve aynısını aşağıdaki &quot;Yönlendirme adresi&quot;ne girin. İzin verince açılmayan sayfanın adresini kanal sayfasına yapıştırmanız yeterli. TikTok localhost&apos;u kabul etmezse kendi sitenizden bir adres kullanın (ör. <code>https://befware.com/tiktok</code>); sayfanın var olması gerekmez.
          </li>
          <li>Client Key ve Client Secret&apos;ı aşağıya girin. Uygulama TikTok incelemesinden geçene kadar videolar <b>taslak</b> olarak gider (TikTok uygulamanıza bildirim gelir, açıklamayı kontrol edip paylaşırsınız). Onaydan sonra kanal ayarından &quot;Doğrudan paylaş&quot;ı seçebilirsiniz.</li>
        </ol>
        <div className="two">
          <div>
            <label>TikTok Client Key</label>
            <input name="tiktokClientKey" defaultValue={s.tiktokClientKey} autoComplete="off" />
          </div>
          <Secret name="tiktokClientSecret" label="TikTok Client Secret" value={s.tiktokClientSecret} />
          <div>
            <label>Yönlendirme adresi (Redirect URI)</label>
            <input name="tiktokRedirectUri" defaultValue={s.tiktokRedirectUri} placeholder={`${c.appUrl}/api/tiktok/callback`} />
          </div>
        </div>

        <h2>Sosyal medya: Instagram Reels</h2>
        <ol className="steps">
          <li>Instagram hesabını <b>profesyonel hesaba</b> çevirin ve bir <b>Facebook sayfasına</b> bağlayın (Asistena&apos;nın Instagram&apos;ı için de geçerli).</li>
          <li><a href="https://developers.facebook.com/apps/" target="_blank">developers.facebook.com/apps</a>&apos;ta <b>Business</b> türünde uygulama oluşturun, <b>Instagram</b> ürününü (Facebook ile giriş) ekleyin.</li>
          <li>App ID ve App Secret&apos;ı (Uygulama ayarları → Temel) aşağıya girin; böylece kanal sayfasına yapıştırdığınız anahtar süresiz sayfa anahtarına çevrilir.</li>
          <li>Hesabı bağlamak için kanal sayfasındaki Instagram adımlarını izleyin. Kendi hesaplarınız için Meta incelemesi gerekmez (uygulamada yönetici olmanız yeterli).</li>
        </ol>
        <div className="two">
          <div>
            <label>Meta App ID</label>
            <input name="metaAppId" defaultValue={s.metaAppId} autoComplete="off" />
          </div>
          <Secret name="metaAppSecret" label="Meta App Secret" value={s.metaAppSecret} />
        </div>

        <h2>Panel şifresi</h2>
        <div className="two">
          <Secret name="panelPassword" label="Şifre (boşsa şifresiz açılır, sadece kendi bilgisayarınızda önerilir)" value={c.panelPassword} />
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button>Anahtarları kaydet</button>
          <button formAction={testKeys} className="secondary">Kayıtlı anahtarları test et</button>
        </div>
      </form>
    </>
  );
}
