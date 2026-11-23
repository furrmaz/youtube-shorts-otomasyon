import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { cfg } from "@/lib/config";
import { getSettings } from "@/lib/settings";
import { listVoices, type Voice } from "@/lib/tts";
import { connectInstagram, connectTiktok, deleteChannel, disconnectPlatform, saveChannel } from "@/app/actions";
import { parsePalette } from "@/lib/look";

export const dynamic = "force-dynamic";

const LANGS = [["tr", "Türkçe"], ["en", "English"], ["de", "Deutsch"], ["es", "Español"], ["fr", "Français"], ["ar", "Arapça"], ["pt", "Português"]];

type SP = { saved?: string; new?: string; yt?: string; msg?: string; ok?: string };

export default async function ChannelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const c = await prisma.channel.findUnique({ where: { id }, include: { connections: true } });
  if (!c) notFound();
  const s = await getSettings();
  const k = await cfg();
  const conn = (p: string) => c.connections.find((x) => x.platform === p);
  const yt = conn("youtube");
  const tt = conn("tiktok");
  const ig = conn("instagram");
  const tiktokReady = !!(s.tiktokClientKey && s.tiktokClientSecret);
  const ttRedirect = s.tiktokRedirectUri || `${k.appUrl}/api/tiktok/callback`;

  let voices: Voice[] = [];
  let voiceErr = "";
  if (k.elevenApiKey) {
    try {
      voices = await listVoices(k.elevenApiKey);
    } catch (e) {
      voiceErr = (e as Error).message;
    }
  }
  const voiceKnown = voices.some((v) => v.voice_id === c.elevenVoiceId);
  const promo = c.contentFormat === "promo";
  const story = c.contentFormat === "story";
  const palette = parsePalette(c.palette);

  return (
    <>
      <p><Link href="/channels">← Kanallar</Link></p>
      <h1>{c.name}</h1>
      {sp.saved && <div className="card">Kaydedildi ✓</div>}
      {sp.new && <div className="card">Kanal oluşturuldu. Aşağıdaki alanları doldurup kaydedin, sonra hesaplarını bağlayın.</div>}
      {sp.yt === "ok" && <div className="card">YouTube kanalı bağlandı ✓</div>}
      {sp.yt === "err" && <div className="card err">YouTube bağlantısı başarısız: {sp.msg}</div>}
      {sp.ok && <div className="card">{sp.ok} ✓</div>}
      {sp.msg && sp.yt !== "err" && <div className="card err">{sp.msg}</div>}

      <div className="card row">
        <span>🎬 Örnek video tarzı: {c.styleOn ? <b>açık</b> : c.styleProfile ? "çözümlendi, uygulanmadı" : "yok"}</span>
        <Link href="/style" className="muted">Örnek video sayfası (seçili kanal için) →</Link>
        {c.styleOn && <span className="muted">Görsel stil, altyazı, müzik ve ton aşağıda örneğe göre dolduruldu; değiştirebilirsin.</span>}
      </div>

      <form action={saveChannel} className="card" encType="multipart/form-data">
        <input type="hidden" name="id" value={c.id} />
        <h2 style={{ marginTop: 0 }}>Kanal ve içerik</h2>
        <div className="two">
          <div>
            <label>Kanal adı</label>
            <input name="name" defaultValue={c.name} />
          </div>
          <div>
            <label>Format</label>
            <select name="contentFormat" defaultValue={c.contentFormat}>
              <option value="promo">Ürün tanıtımı (30-45 sn, uygulama/ürün reklamı)</option>
              <option value="info">Bilgi videosu (45-60 sn, günlük takvim)</option>
              <option value="story">Etkileşimli hikâye dizisi (bölümler, A/B seçim)</option>
            </select>
            <div className="muted">Formatı değiştirip kaydedince ilgili alanlar açılır.</div>
          </div>
        </div>

        {promo && (
          <div className="card" style={{ background: "#0c0e12", marginTop: 12 }}>
            <b>Ürün bilgileri</b>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Claude tanıtım videolarını sadece burada yazanlara dayanarak yazar; olmayan özellik, rakam veya müşteri uydurmaz. Ne kadar somut yazarsanız o kadar iyi olur.
            </p>
            <div className="two">
              <div>
                <label>Ürün adı</label>
                <input name="productName" defaultValue={c.productName} placeholder="ör. Asistena" />
              </div>
              <div>
                <label>Web adresi (videonun sonunda ve açıklamada)</label>
                <input name="productUrl" defaultValue={c.productUrl} placeholder="ör. asistena.com" />
              </div>
            </div>
            <label>Çözdüğü sorun</label>
            <textarea name="productProblem" defaultValue={c.productProblem} style={{ minHeight: 70 }} />
            <label>Özellikler (satır satır)</label>
            <textarea name="productFeatures" defaultValue={c.productFeatures} style={{ minHeight: 90 }} />
            <div className="two">
              <div>
                <label>Hedef kitle</label>
                <input name="targetAudience" defaultValue={c.targetAudience} />
              </div>
              <div>
                <label>Çağrı (videonun son kartı)</label>
                <input name="cta" defaultValue={c.cta} placeholder="ör. Ücretsiz demo isteyin" />
              </div>
            </div>
            <label>Satış videosu sektörleri (virgülle veya satır satır)</label>
            <textarea name="sectors" defaultValue={c.sectors} style={{ minHeight: 60 }} placeholder="diş kliniği, oto servis, emlak…" />
            <div className="muted">Satış videoları sayfasında bu sektörlerin her biri için ayrı kısa video üretilir.</div>
          </div>
        )}
        {!promo && (
          <>
            {["productName", "productUrl", "productProblem", "productFeatures", "targetAudience", "cta", "sectors"].map((f) => (
              <input key={f} type="hidden" name={f} value={String(c[f as keyof typeof c] ?? "")} />
            ))}
          </>
        )}

        <label>{promo ? "Konu alanı (boşsa ürün ve sorundan çıkarılır)" : "Niş / kategori"}</label>
        <input name="niche" defaultValue={c.niche} placeholder="ör. uzay ve astronomi gerçekleri, finansal okuryazarlık" />
        <div className="two">
          <div>
            <label>Dil</label>
            <select name="language" defaultValue={c.language}>
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label>Kanal tonu</label>
            <input name="channelStyle" defaultValue={c.channelStyle} />
          </div>
        </div>

        {story ? (
          <div className="card" style={{ background: "#0c0e12", marginTop: 12 }}>
            <b>Hikâye dizisi</b>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Boş bırakılan alanları Claude ilk bölümde doldurur. Her bölüm A/B seçimiyle biter; sonraki bölüm yorumlarda en çok yazılan seçime göre devam eder.
            </p>
            <div className="two">
              <div>
                <label>Dizi adı</label>
                <input name="seriesTitle" defaultValue={c.seriesTitle} />
              </div>
              <div>
                <label>Bölüm süresi (dakika, en fazla 2.8)</label>
                <input name="storyMinutes" type="number" step="0.1" min={1} max={2.8} defaultValue={c.storyMinutes} />
              </div>
            </div>
            <label>Dizinin konusu</label>
            <textarea name="seriesPremise" defaultValue={c.seriesPremise} style={{ minHeight: 80 }} />
            <label>Karakterlerin görünüşü (İngilizce, görsel tutarlılık için)</label>
            <textarea name="seriesCharacters" defaultValue={c.seriesCharacters} style={{ minHeight: 70 }} />
          </div>
        ) : (
          <>
            <input type="hidden" name="seriesTitle" value={c.seriesTitle} />
            <input type="hidden" name="seriesPremise" value={c.seriesPremise} />
            <input type="hidden" name="seriesCharacters" value={c.seriesCharacters} />
            <input type="hidden" name="storyMinutes" value={c.storyMinutes} />
          </>
        )}

        <h2>Marka</h2>
        <div className="two">
          <div>
            <label>Renkler (ana / vurgu)</label>
            <div className="colors">
              <input type="color" name="primaryColor" defaultValue={c.primaryColor} />
              <input type="color" name="accentColor" defaultValue={c.accentColor} />
            </div>
            <div className="muted">Ana renk ilerleme çubuğunda, vurgulu altyazı kelimesinde ve son kartta kullanılır; ikisi de çizimlere yansır.</div>
          </div>
          <div>
            <label>Logo (PNG, şeffaf arka plan önerilir; sol üstte küçük görünür)</label>
            <div className="row">
              {c.logoPath && <img src={`/api/media/brand/${c.id}.png?v=${c.updatedAt.getTime()}`} alt="" style={{ height: 40, background: "#0c0e12", borderRadius: 6 }} />}
              <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ flex: 1 }} />
            </div>
            {c.logoPath && (
              <label style={{ display: "inline-flex", gap: 4 }}>
                <input type="checkbox" name="clearLogo" style={{ width: "auto" }} /> logoyu kaldır
              </label>
            )}
          </div>
        </div>
        <label>Görsel stil (İngilizce; boşsa marka renklerine göre sade vektör stili)</label>
        <textarea name="visualStyle" defaultValue={c.visualStyle} style={{ minHeight: 60 }} />
        <div className="two">
          <div>
            <label>ElevenLabs sesi</label>
            {voices.length > 0 ? (
              <select name="elevenVoiceId" defaultValue={c.elevenVoiceId}>
                <option value="">— ses seçin —</option>
                {!voiceKnown && c.elevenVoiceId && <option value={c.elevenVoiceId}>{c.elevenVoiceId}</option>}
                {voices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name}
                    {v.labels ? ` · ${Object.values(v.labels).filter(Boolean).slice(0, 3).join(", ")}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input name="elevenVoiceId" defaultValue={c.elevenVoiceId} placeholder="Ses ID (anahtarı girince liste çıkar)" />
            )}
            {voiceErr && <div className="err">{voiceErr}</div>}
          </div>
          <div>
            <label>Altyazı</label>
            <select name="subtitleStyle" defaultValue={c.subtitleStyle}>
              <option value="karaoke">Büyük, kelime kelime vurgulu</option>
              <option value="line">Tek satır, gölgeli (en fazla {c.captionMaxChars} harf)</option>
              <option value="minimal">Sade, alt kısımda</option>
              <option value="off">Kapalı</option>
            </select>
          </div>
          <div>
            <label>Filigran (ör. @kanaladi, boşsa yok)</label>
            <input name="watermark" defaultValue={c.watermark} />
          </div>
          <div>
            <label>Müzik tarifi (ElevenLabs müziği için, İngilizce)</label>
            <input name="musicPrompt" defaultValue={c.musicPrompt} placeholder="upbeat modern tech corporate, light percussion, no vocals" />
          </div>
        </div>

        <h2 id="gorsel-dil">Görsel dil ve metin</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Her videoda aynı renkler, aynı font ve aynı kapanış: kanal tanınır, &quot;yapay zekâ yaptı&quot; hissi azalır.
        </p>
        <div className="two">
          <div>
            <label>Renk paleti (en fazla 4 renk, ör. colorhunt.co&apos;dan kopyala)</label>
            <input name="palette" defaultValue={c.palette} placeholder="#7A1E2C, #F2C14E, #1B1B1B, #F5F0E6" />
            {palette.length > 0 && (
              <div className="row" style={{ gap: 4, marginTop: 6 }}>
                {palette.map((p) => <span key={p} title={p} style={{ width: 28, height: 28, borderRadius: 6, background: p, border: "1px solid #333" }} />)}
              </div>
            )}
            <div className="muted">Doluysa çizimler, altyazı vurgusu, kartlar ve ilerleme çubuğu bu renklerle yapılır; dışına sadece beyaz çıkılır. Boşsa yukarıdaki iki marka rengi kullanılır.</div>
          </div>
          <div>
            <label>Kendi fontun (.ttf / .otf, altyazı ve başlıklarda)</label>
            <input type="file" name="font" accept=".ttf,.otf,font/ttf,font/otf" />
            {c.fontFamily && (
              <div className="row">
                <span>Yüklü: <b>{c.fontFamily}</b></span>
                <label style={{ display: "inline-flex", gap: 4 }}>
                  <input type="checkbox" name="clearFont" style={{ width: "auto" }} /> fontu kaldır
                </label>
              </div>
            )}
            <div className="two">
              <div>
                <label>Harf aralığı (Premiere tracking, ör. -40)</label>
                <input name="fontTracking" type="number" min={-200} max={200} defaultValue={c.fontTracking} />
              </div>
              <div>
                <label>Tek satır altyazıda en fazla harf</label>
                <input name="captionMaxChars" type="number" min={15} max={60} defaultValue={c.captionMaxChars} />
              </div>
            </div>
          </div>
        </div>
        <div className="checks" style={{ marginTop: 8 }}>
          <label title="Yumuşak geçişler, yavaş kamera, parçacık yok">
            <input type="checkbox" name="simpleMotion" defaultChecked={c.simpleMotion} /> Sade kurgu (yumuşak geçiş, yavaş kamera, uçuşan efekt yok)
          </label>
          <label title="Metinde maç, gol, yıl gibi sayılar geçince ekranda sade bir kart çıkar; futbolda mevki saha çiziminde gösterilir">
            <input type="checkbox" name="statCards" defaultChecked={c.statCards} /> İstatistik kartları (ör. 116 MAÇ · 20 GOL, saha üzerinde mevki)
          </label>
        </div>
        <div className="two">
          <div>
            <label>Sabit kapanış cümlesi (her videonun son cümlesi)</label>
            <input name="endLine" defaultValue={c.endLine} placeholder="ör. Merak ettiğin efsaneyi yoruma yaz, serinin diğer videosunda onu anlatalım." />
            <div className="muted">Yorum getirir; yorumlarda istenen konular <Link href="/ideas">İzleyici istekleri</Link> sayfasına düşer.</div>
          </div>
          {!story ? (
            <div>
              <label>Video süresi (saniye, 30-170)</label>
              <input name="infoSeconds" type="number" min={30} max={170} defaultValue={c.infoSeconds} />
              <div className="muted">Örnek futbol kanalında 60-90 sn&apos;lik videolar ortalama ~1 dk izlendi.</div>
            </div>
          ) : (
            <input type="hidden" name="infoSeconds" value={c.infoSeconds} />
          )}
        </div>
        <label>Beğendiğin kanca örnekleri (satır satır; Claude bu tonu yakalamaya çalışır)</label>
        <textarea
          name="hookExamples"
          defaultValue={c.hookExamples}
          style={{ minHeight: 80 }}
          placeholder={"Her geçen sene o senenin Nijerya güzeliyle evlenen yıldız futbolcu Emenike'ye ne oldu?\nDaha ortada Icardi ve Osimhen yokken Galatasaraylıların bomba golcüsü olan Gomis'e ne oldu?"}
        />

        <h2>Yayın planı</h2>
        <div className="two">
          <div>
            <label>Günde video sayısı</label>
            <input type="number" min={1} max={5} name="videosPerDay" defaultValue={c.videosPerDay} />
          </div>
          <div>
            <label>Yayın saatleri (virgülle, ör. 12:00, 19:00)</label>
            <input name="publishTimes" defaultValue={c.publishTimes} />
          </div>
          <div>
            <label>YouTube&apos;a 24 saatte en fazla otomatik yükleme (0 = sınırsız)</label>
            <input type="number" min={0} max={20} name="maxUploadsPerDay" defaultValue={c.maxUploadsPerDay} />
            <div className="muted">Örnek kanalda YouTube günde ~5 yüklemeden sonra engelledi. Sınır dolunca video bekler, ertesi gün yüklenir; elle &quot;Şimdi yayınla&quot; sınırı aşar.</div>
          </div>
          <div>
            <label>YouTube gizliliği</label>
            <select name="privacyStatus" defaultValue={c.privacyStatus}>
              <option value="public">Herkese açık</option>
              <option value="unlisted">Liste dışı</option>
              <option value="private">Özel</option>
            </select>
          </div>
          <div>
            <label>&nbsp;</label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text)" }}>
              <input type="checkbox" name="autoProduce" defaultChecked={c.autoProduce} style={{ width: "auto" }} />
              Bu kanalda otomatik üret ve yayınla
            </label>
          </div>
        </div>

        <h2>Nerede yayınlansın</h2>
        <div className="checks">
          <label><input type="checkbox" name="toYoutube" defaultChecked={c.toYoutube} /> YouTube Shorts</label>
          <label><input type="checkbox" name="toTiktok" defaultChecked={c.toTiktok} /> TikTok</label>
          <label><input type="checkbox" name="toInstagram" defaultChecked={c.toInstagram} /> Instagram Reels</label>
        </div>
        <label>TikTok yükleme şekli</label>
        <select name="tiktokMode" defaultValue={c.tiktokMode} style={{ maxWidth: 520 }}>
          <option value="draft">Taslak olarak gönder (TikTok uygulamasında bildirime gelir, siz paylaşırsınız)</option>
          <option value="direct">Doğrudan paylaş (TikTok uygulama incelemesi onaylandıktan sonra)</option>
        </select>
        <div className="muted">İşaretli olup hesabı bağlı olmayan platformlar atlanır.</div>

        <div style={{ marginTop: 16 }}>
          <button>Kaydet</button>
        </div>
      </form>

      <div className="card" id="baglantilar">
        <h2 style={{ marginTop: 0 }}>Hesap bağlantıları</h2>

        <h3>YouTube</h3>
        {yt ? (
          <form action={disconnectPlatform} className="row">
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="platform" value="youtube" />
            <span>📺 <b>{yt.accountName}</b></span>
            <button className="secondary">Bağlantıyı kes</button>
          </form>
        ) : (
          <div className="row">
            <a className="btn" href={`/api/youtube/connect?channel=${c.id}`}>YouTube kanalını bağla</a>
            <span className="muted">
              Bu kanal için hangi YouTube kanalını kullanacaksanız Google&apos;da onu seçin (bir Google hesabında birden çok YouTube kanalı olabilir).
            </span>
          </div>
        )}

        <h3>TikTok</h3>
        {tt ? (
          <form action={disconnectPlatform} className="row">
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="platform" value="tiktok" />
            <span>🎵 <b>{tt.accountName}</b></span>
            <button className="secondary">Bağlantıyı kes</button>
          </form>
        ) : !tiktokReady ? (
          <p className="muted">Önce <Link href="/settings#sosyal">Ayarlar → Sosyal medya</Link>&apos;dan TikTok Client Key ve Secret girin.</p>
        ) : (
          <>
            <ol className="steps">
              <li><a href={`/api/tiktok/connect?channel=${c.id}`} target="_blank">TikTok&apos;ta oturum açıp izin verin</a> (yeni sekmede açılır).</li>
              <li>
                İzin verince tarayıcı <code>{ttRedirect}</code> adresine döner. Sayfa açılmasa bile adres çubuğundaki adresin tamamını kopyalayıp aşağıya yapıştırın.
              </li>
            </ol>
            <form action={connectTiktok} className="row" style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={c.id} />
              <input name="code" placeholder="https://…?code=…  (dönüş adresi)" style={{ flex: 1, minWidth: 260 }} />
              <button>TikTok&apos;u bağla</button>
            </form>
          </>
        )}

        <h3>Instagram Reels</h3>
        {ig ? (
          <form action={disconnectPlatform} className="row">
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="platform" value="instagram" />
            <span>📸 <b>@{ig.accountName}</b></span>
            <button className="secondary">Bağlantıyı kes</button>
          </form>
        ) : (
          <>
            <ol className="steps">
              <li>Instagram hesabı <b>profesyonel (işletme veya üretici)</b> olmalı ve bir <b>Facebook sayfasına bağlı</b> olmalı (Instagram → Ayarlar → Hesap türü).</li>
              <li>
                <a href="https://developers.facebook.com/tools/explorer/" target="_blank">Graph API Explorer</a>&apos;da Meta uygulamanızı seçin, şu izinleri ekleyin:{" "}
                <code>instagram_basic</code> <code>instagram_content_publish</code> <code>pages_show_list</code> <code>pages_read_engagement</code> <code>business_management</code>
              </li>
              <li>&quot;Generate Access Token&quot; deyip çıkan anahtarı aşağıya yapıştırın. Ayarlar&apos;a Meta App ID/Secret girdiyseniz anahtar otomatik uzun ömürlüye çevrilir.</li>
            </ol>
            <form action={connectInstagram} className="row" style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={c.id} />
              <input name="token" type="password" placeholder="Erişim anahtarı (EAA…)" style={{ flex: 2, minWidth: 220 }} autoComplete="off" />
              <input name="username" placeholder="kullanıcı adı (birden fazla hesap varsa)" style={{ flex: 1, minWidth: 160 }} />
              <button>Instagram&apos;ı bağla</button>
            </form>
          </>
        )}
      </div>

      <form action={deleteChannel} className="card">
        <input type="hidden" name="id" value={c.id} />
        <h2 style={{ marginTop: 0 }}>Kanalı sil</h2>
        <p className="muted">Kanalın tüm videoları ve bağlantıları da silinir. YouTube/TikTok/Instagram&apos;daki yayınlanmış videolar etkilenmez.</p>
        <button className="danger">Kanalı sil</button>
      </form>
    </>
  );
}
