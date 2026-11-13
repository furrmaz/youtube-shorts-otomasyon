import { getSettings } from "@/lib/settings";
import { saveSettings } from "../actions";

export const dynamic = "force-dynamic";

const LANGS = [["tr", "Türkçe"], ["en", "English"], ["de", "Deutsch"], ["es", "Español"], ["fr", "Français"], ["ar", "Arapça"], ["pt", "Português"]];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const s = await getSettings();
  const { saved } = await searchParams;
  const env = {
    claude: !!process.env.ANTHROPIC_API_KEY,
    eleven: !!process.env.ELEVENLABS_API_KEY,
    fal: !!process.env.FAL_KEY,
    replicate: !!process.env.REPLICATE_API_TOKEN,
    google: !!process.env.GOOGLE_CLIENT_ID,
  };
  return (
    <>
      <h1>Ayarlar</h1>
      {saved && <p className="muted">Kaydedildi.</p>}
      <div className="card muted">
        API anahtarları (.env): Claude {env.claude ? "✓" : "✗"} · ElevenLabs {env.eleven ? "✓" : "✗"} · fal.ai{" "}
        {env.fal ? "✓" : "✗"} · Replicate {env.replicate ? "✓" : "✗"} · Google OAuth {env.google ? "✓" : "✗"}
      </div>
      <form action={saveSettings} className="card">
        <h2 style={{ marginTop: 0 }}>Kanal ve içerik</h2>
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
            <label>ElevenLabs ses ID</label>
            <input name="elevenVoiceId" defaultValue={s.elevenVoiceId} placeholder="ör. 21m00Tcm4TlvDq8ikWAM" />
          </div>
          <div>
            <label>Görsel sağlayıcı</label>
            <select name="imageProvider" defaultValue={s.imageProvider}>
              <option value="fal">fal.ai (Flux)</option>
              <option value="replicate">Replicate (Flux)</option>
              <option value="mock">Deneme (degrade, anahtar gerekmez)</option>
            </select>
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
    </>
  );
}
