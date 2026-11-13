# YouTube Shorts Otomasyon

Bir niş seçersiniz; panel Claude ile nişi araştırır, 30 günlük içerik takvimi (konu, kanca, 45-60 sn metin, başlık, açıklama, etiket) yazar. Siz onaylar veya düzenlersiniz. Sonra her gün otomatik olarak:

1. **ElevenLabs** metni seslendirir (kelime kelime zamanlamayla)
2. **Claude** metni 6-10 sahneye böler ve hepsi aynı çizim stilinde olacak görsel istemleri yazar
3. **Görsel modeli** (fal.ai Flux veya Replicate Flux) sahneleri çizer
4. **FFmpeg** 1080x1920 dikey video hazırlar: Ken Burns yakınlaşma/kaydırma, sahne geçişleri, kelime kelime vurgulu altyazı
5. **YouTube Data API** videoyu Shorts olarak yükler; ileri tarihliyse YouTube'un kendi zamanlamasıyla yayınlanır

Panelde her videonun durumu (Taslak → Onaylı → Üretiliyor → Hazır → Yüklendi), önizlemesi, sahne görselleri ve işlem kayıtları görünür.

## Gereksinimler

- Node.js 20+ (22 önerilir)
- FFmpeg (libass ile; Ubuntu/Debian'da `apt install ffmpeg`, macOS'ta `brew install ffmpeg`, Windows'ta ffmpeg.org'dan "full" sürüm)

## Kurulum

```bash
npm install
cp .env.example .env        # anahtarları doldurun
npx prisma db push          # SQLite veritabanını oluşturur
npm run demo                # (isteğe bağlı) anahtarsız deneme videosu üretir -> media/<id>/short.mp4
npm run build
npm start                   # panel: http://localhost:3000
npm run worker              # ayrı terminalde: zamanlayıcı (üretim + yükleme)
```

Geliştirme sırasında `npm run dev` kullanabilirsiniz. Panel ve worker aynı `.env` ve veritabanını kullanır, ikisi de sürekli çalışmalıdır.

## Anahtarlar (.env)

| Değişken | Nereden |
|---|---|
| `PANEL_PASSWORD` | Kendi belirlediğiniz panel şifresi |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `ELEVENLABS_API_KEY` | elevenlabs.io → Profile → API Keys. Ses ID'si panelde Ayarlar'a girilir |
| `FAL_KEY` veya `REPLICATE_API_TOKEN` | fal.ai veya replicate.com hesabı |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Aşağıdaki adımlar |

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
