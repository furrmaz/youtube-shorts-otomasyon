# YouTube Shorts Otomasyon

Bir niş seçersiniz; panel Claude ile nişi araştırır, 30 günlük içerik takvimi (konu, kanca, 45-60 sn metin, başlık, açıklama, etiket) yazar. Siz onaylar veya düzenlersiniz. Sonra her gün otomatik olarak:

1. **ElevenLabs** metni seslendirir (kelime kelime zamanlamayla)
2. **Claude** metni 6-10 sahneye böler ve hepsi aynı çizim stilinde olacak görsel istemleri yazar
3. **Görsel modeli** (fal.ai Flux veya Replicate Flux) sahneleri çizer
4. **FFmpeg** 1080x1920 dikey video hazırlar: Ken Burns yakınlaşma/kaydırma, sahne geçişleri, kelime kelime vurgulu altyazı
5. **YouTube Data API** videoyu Shorts olarak yükler; ileri tarihliyse YouTube'un kendi zamanlamasıyla yayınlanır

Panelde her videonun durumu (Taslak → Onaylı → Üretiliyor → Hazır → Yüklendi), önizlemesi, sahne görselleri ve işlem kayıtları görünür.

## Kendi bilgisayarınızda kurulum

### 1. Gerekli programlar (bir kez)

**Windows**
1. **Node.js 22 LTS**: nodejs.org'dan indirip kurun.
2. **FFmpeg**: PowerShell'i açıp `winget install Gyan.FFmpeg` yazın, sonra PowerShell'i kapatıp yeniden açın. `ffmpeg -version` çalışıyorsa tamam.
3. **Git**: `winget install Git.Git` (ya da GitHub Desktop).

**macOS**: `brew install node ffmpeg git`

### 2. Projeyi indirip kurun (bir kez)

```bash
git clone https://github.com/furrmaz/youtube-shorts-otomasyon.git
cd youtube-shorts-otomasyon
npm install
copy .env.example .env      # macOS/Linux: cp .env.example .env
```

`.env` dosyasını Not Defteri ile açıp en azından `PANEL_PASSWORD` ve `ANTHROPIC_API_KEY` değerlerini girin (diğerleri aşağıda). Sonra:

```bash
npm run kurulum             # veritabanını oluşturur ve uygulamayı derler
npm run demo                # (isteğe bağlı) anahtarsız deneme videosu -> media/<id>/short.mp4
```

### 3. Çalıştırma (her seferinde)

```bash
npm run baslat
```

Tarayıcıda **http://localhost:3000** adresini açın. Bu komut paneli ve zamanlayıcıyı birlikte çalıştırır; videoların üretilip yüklenmesi için pencere açık kalmalı ve bilgisayar uykuya geçmemeli. Kapatmak için `Ctrl+C`.

İpucu: Videolar yayın saatinden `produceHoursAhead` saat önce (varsayılan 6) üretilip YouTube'a ileri tarihli yüklenir. YouTube yayını kendisi yapar, yani yükleme bittikten sonra bilgisayarın açık olması gerekmez. Bilgisayarı günde bir kez birkaç saat açık tutmanız yeterli; daha fazla günü önceden hazırlamak için Ayarlar'dan bu süreyi artırabilirsiniz (ör. 48).

`.env` veya kod değiştiyse `npm run kurulum` komutunu tekrar çalıştırın.

## Anahtarlar (.env)

| Değişken | Nereden |
|---|---|
| `PANEL_PASSWORD` | Kendi belirlediğiniz panel şifresi |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `ELEVENLABS_API_KEY` | elevenlabs.io → Profile → API Keys. Ses ID'si panelde Ayarlar'a girilir |
| `FAL_KEY` veya `REPLICATE_API_TOKEN` | fal.ai veya replicate.com hesabı |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Aşağıdaki adımlar |

`.env` içinde `ffmpeg` bulunamazsa tam yolunu `FFMPEG_PATH` ve `FFPROBE_PATH` ile verebilirsiniz.

Anahtar olmadan da panel çalışır: Ayarlar'da ses ve görsel sağlayıcısını "Deneme" seçerseniz sessiz ses ve degrade görsellerle tüm hat denenebilir. Takvim üretimi için Claude anahtarı şarttır.

### YouTube bağlantısı (Google Cloud)

1. console.cloud.google.com'da bir proje açın, **YouTube Data API v3**'ü etkinleştirin.
2. *OAuth consent screen*: External, uygulama adını girin, kendi Gmail adresinizi **Test users** listesine ekleyin.
3. *Credentials → Create credentials → OAuth client ID → Web application*. Authorized redirect URI: `APP_URL/api/youtube/callback` (ör. `http://localhost:3000/api/youtube/callback`).
4. Client ID ve secret'ı `.env`'e yazın, panelde **YouTube kanalını bağla**'ya basın.

> **Önemli:** Google, doğrulanmamış (audit edilmemiş) API projelerinden yüklenen videoları **özel (private) olarak kilitler**. Herkese açık yayın için projeniz için Google'a "YouTube API Services audit" başvurusu yapmanız gerekir (ücretsiz, birkaç gün-hafta sürebilir). Bu sürede videolar yüklenir ama özel kalır; elle herkese açık yapabilirsiniz.
>
> Varsayılan API kotası günde 10.000 birimdir; her yükleme yaklaşık 1.600 birim harcar, yani günde ~6 video.

## Nasıl çalışır

- **Ayarlar**: niş, dil, kanal tonu, görsel stil, ElevenLabs ses ID, günde kaç video, yayın saatleri, saat dilimi, gizlilik.
- **İçerik takvimi → Takvim oluştur**: Claude web aramasıyla nişi araştırır, sonra 6'şarlı gruplar halinde senaryoları yazar (birkaç dakika sürer). Takvim, var olan son planlı günden sonra devam eder.
- Taslakları düzenleyip **Onayla** (veya "Tüm taslakları onayla").
- **Worker** her dakika bakar: yayın saatine `produceHoursAhead` saat kalan onaylı videoları üretir, hazır olanları YouTube'a yükler (ileri tarihli yayınla). İsterseniz video detayında **Şimdi üret** / **YouTube'a yükle** ile elle de tetikleyebilirsiniz.
- Üretim yarıda kalırsa tekrar denendiğinde var olan ses ve görseller yeniden üretilmez, kaldığı yerden devam eder.
- Yüklemede YouTube'un "değiştirilmiş/sentetik içerik" beyanı işaretlenir.

## Yapı

```
src/lib/claude.ts    Araştırma (web arama), takvim ve sahne planı (yapılandırılmış çıktı)
src/lib/tts.ts       ElevenLabs (with-timestamps) + deneme sağlayıcısı
src/lib/images.ts    Görsel sağlayıcıları: fal, replicate, mock (yenisini eklemek kolay)
src/lib/video.ts     Sahne zamanlama, Ken Burns klipleri, geçişler, ASS altyazı, montaj
src/lib/youtube.ts   OAuth ve yükleme
src/lib/pipeline.ts  Takvim üretimi, üretim, yükleme, zamanlayıcı turu
scripts/worker.ts    Sürekli çalışan zamanlayıcı
src/app/             Panel sayfaları (Next.js App Router)
```

## Maliyet (video başına yaklaşık)

- Claude (sahne planı) + takvimdeki payı: birkaç sent
- ElevenLabs: 50 sn ses ≈ 800-900 karakter
- Görsel: 6-10 Flux görseli (flux/schnell ≈ 0,003 $, flux/dev ≈ 0,025 $ / görsel)

## Sonraki adımlar

- Görselden videoya animasyon (ör. Higgsfield/Kling) isteğe bağlı sağlayıcı olarak `images.ts` yanına eklenebilir
- Arka plan müziği, kanal analitiği, birden fazla kanal
