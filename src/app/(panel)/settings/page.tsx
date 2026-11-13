import { getSettings } from "@/lib/settings";
import { cfg, mask } from "@/lib/config";
import { listVoices, type Voice } from "@/lib/tts";
import { saveKeys, saveSettings, testKeys } from "@/app/actions";

export const dynamic = "force-dynamic";

const LANGS = [["tr", "Türkçe"], ["en", "English"], ["de", "Deutsch"], ["es", "Español"], ["fr", "Français"], ["ar", "Arapça"], ["pt", "Português"]];

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
  const { saved, test } = await searchParams;
  const tests: Record<string, string> | null = test ? JSON.parse(test) : null;

  let voices: Voice[] = [];
  let voiceErr = "";
  if (c.elevenApiKey) {
    try {
      voices = await listVoices(c.elevenApiKey);
    } catch (e) {
      voiceErr = (e as Error).message;
    }
  }
  const voiceKnown = voices.some((v) => v.voice_id === s.elevenVoiceId);

  return (
    <>
      <h1>Ayarlar</h1>
      {saved && <div className="card">Kaydedildi ✓</div>}

      <form action={saveSettings} className="card">
        <h2 style={{ marginTop: 0 }}>Kanal ve içerik</h2>
        <label>Format</label>
        <select name="contentFormat" defaultValue={s.contentFormat}>
          <option value="info">Bilgi videosu (45-60 sn, günlük takvim)</option>
          <option value="story">Etkileşimli hikâye dizisi (bölümler, A/B seçim, yorum oyları)</option>
        </select>
        <div className="muted">Formatı değiştirip kaydedince ilgili ayarlar açılır.</div>
        <label>Niş / kategori</label>
        <input name="niche" defaultValue={s.niche} placeholder="ör. uzay ve astronomi gerçekleri, finansal okuryazarlık, tarih" />
        <div className="two">
          <div>
            <label>Dil</label>
            <select name="language" defaultValue={s.language}>
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label>Kanal tonu</label>
            <input name="channelStyle" defaultValue={s.channelStyle} />
          </div>
        </div>
        {s.contentFormat === "story" && (
          <div className="card" style={{ background: "#0c0e12", marginTop: 12 }}>
            <b>Hikâye dizisi</b>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Boş bırakılan alanları Claude ilk bölümde doldurur. Her bölüm A/B seçimiyle biter; sonraki bölüm yorumlarda en çok
              yazılan seçime göre devam eder.
            </p>
            <div className="two">
              <div>
                <label>Dizi adı</label>
                <input name="seriesTitle" defaultValue={s.seriesTitle} placeholder="ör. Son Şerit" />
              </div>
              <div>
                <label>Bölüm süresi (dakika, en fazla 2.8)</label>
                <input name="storyMinutes" type="number" step="0.1" min={1} max={2.8} defaultValue={s.storyMinutes} />
              </div>
            </div>
            <label>Dizinin konusu</label>
            <textarea name="seriesPremise" defaultValue={s.seriesPremise} style={{ minHeight: 80 }}
              placeholder="ör. Gece yarısı kilitlenen bir otoyolda mahsur kalan sürücüler; telsizden gelen tuhaf anonslar…" />
            <label>Karakterlerin görünüşü (İngilizce, görsel tutarlılık için)</label>
            <textarea name="seriesCharacters" defaultValue={s.seriesCharacters} style={{ minHeight: 70 }}
              placeholder="ör. Driver: round pale head, short dark hair, grey hoodie…" />
          </div>
        )}
        {s.contentFormat !== "story" && (
          <>
            <input type="hidden" name="seriesTitle" value={s.seriesTitle} />
            <input type="hidden" name="seriesPremise" value={s.seriesPremise} />
            <input type="hidden" name="seriesCharacters" value={s.seriesCharacters} />
            <input type="hidden" name="storyMinutes" value={s.storyMinutes} />
          </>
        )}
        <label>Görsel stil (tüm sahnelerde aynı, İngilizce önerilir)</label>
        <textarea name="visualStyle" defaultValue={s.visualStyle} style={{ minHeight: 70 }} />

        <h2>Ses ve görsel üretimi</h2>
        <div className="two">
          <div>
            <label>Seslendirme</label>
            <select name="ttsProvider" defaultValue={s.ttsProvider}>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="mock">Deneme (sessiz, anahtar gerekmez)</option>
            </select>
          </div>
          <div>
            <label>ElevenLabs sesi</label>
            {voices.length > 0 ? (
              <select name="elevenVoiceId" defaultValue={s.elevenVoiceId.startsWith("sk_") ? "" : s.elevenVoiceId}>
                <option value="">— ses seçin —</option>
                {!voiceKnown && s.elevenVoiceId && !s.elevenVoiceId.startsWith("sk_") && <option value={s.elevenVoiceId}>{s.elevenVoiceId}</option>}
                {voices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name}
                    {v.labels ? ` · ${Object.values(v.labels).filter(Boolean).slice(0, 3).join(", ")}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input name="elevenVoiceId" defaultValue={s.elevenVoiceId} placeholder="Ses ID (anahtarı girince liste çıkar)" />
            )}
            {voiceErr && <div className="err">{voiceErr}</div>}
            {s.elevenVoiceId.startsWith("sk_") && <div className="err">Bu alana API anahtarı girilmiş; listeden bir ses seçip kaydedin.</div>}
          </div>
          <div>
            <label>Görsel sağlayıcı</label>
            <select name="imageProvider" defaultValue={s.imageProvider}>
              <option value="claude">Claude çizimi (vektör, ek anahtar gerekmez)</option>
              <option value="fal">fal.ai (Flux)</option>
              <option value="replicate">Replicate (Flux)</option>
              <option value="mock">Deneme (degrade, anahtar gerekmez)</option>
            </select>
          </div>
        </div>

        <div className="two">
          <div>
            <label>Altyazı</label>
            <select name="subtitleStyle" defaultValue={s.subtitleStyle}>
              <option value="karaoke">Büyük, kelime kelime vurgulu</option>
              <option value="minimal">Sade, alt kısımda</option>
              <option value="off">Kapalı</option>
            </select>
          </div>
          <div>
            <label>Filigran (ör. kanal adı, boşsa yok)</label>
            <input name="watermark" defaultValue={s.watermark} placeholder="@kanaladi" />
          </div>
          <div>
            <label>Arka plan müziği seviyesi (0 = kapalı, 0.12 önerilir)</label>
            <input name="musicVolume" type="number" step="0.01" min={0} max={1} defaultValue={s.musicVolume} />
            <div className="muted">Proje klasöründeki <code>music</code> klasörüne koyduğunuz mp3&apos;lerden biri rastgele seçilir.</div>
          </div>
        </div>

        <h2>Yayın planı</h2>
        <div className="two">
          <div>
            <label>Günde video sayısı</label>
            <input type="number" min={1} max={5} name="videosPerDay" defaultValue={s.videosPerDay} />
          </div>
          <div>
            <label>Yayın saatleri (virgülle, ör. 12:00, 19:00)</label>
            <input name="publishTimes" defaultValue={s.publishTimes} />
          </div>
          <div>
            <label>Saat dilimi</label>
            <input name="timezone" defaultValue={s.timezone} />
          </div>
          <div>
            <label>Gizlilik</label>
            <select name="privacyStatus" defaultValue={s.privacyStatus}>
              <option value="public">Herkese açık</option>
              <option value="unlisted">Liste dışı</option>
              <option value="private">Özel</option>
            </select>
          </div>
          <div>
            <label>Yayından kaç saat önce üretilsin</label>
            <input type="number" min={1} name="produceHoursAhead" defaultValue={s.produceHoursAhead} />
          </div>
          <div>
            <label>&nbsp;</label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text)" }}>
              <input type="checkbox" name="autoProduce" defaultChecked={s.autoProduce} style={{ width: "auto" }} />
              Otomatik üret ve yükle
            </label>
          </div>
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
