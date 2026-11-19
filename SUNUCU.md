# Sunucuda 7/24 çalıştırma (Hetzner)

Panel ve zamanlayıcı bir Docker kapsayıcısında çalışır. Sunucu yeniden başlasa da kendiliğinden açılır, alan adınızda otomatik HTTPS olur, veritabanı her gece yedeklenir. Kendi bilgisayarınızı açık tutmanız gerekmez.

## Ne gerekiyor

- **Sunucu:** Hetzner Cloud **CX22** (2 vCPU, 4 GB RAM, 40 GB disk) yeterli, aylık ~4-5 €. Daha hızlı montaj için CX32. İşletim sistemi: **Ubuntu 24.04**.
- **Alan adı:** ör. `panel.siteniz.com`. Alan adı sağlayıcınızda bir **A kaydı** açıp sunucunun IP adresine yönlendirin. Google girişi (YouTube bağlantısı) HTTPS ve alan adı ister, çıplak IP ile çalışmaz.

## Kurulum (bir kez, ~10 dakika)

1. Hetzner Cloud Console → **Add Server** → Location: Falkenstein/Nürnberg/Helsinki, Image: **Ubuntu 24.04**, Type: **CX22**. SSH anahtarınızı ekleyin (yoksa e-postayla gelen root şifresi de olur).
2. Sunucunun IP adresini alan adınızın A kaydına yazın.
3. Sunucuya bağlanın (Windows'ta PowerShell):
   ```
   ssh root@SUNUCU_IP
   ```
4. Kurulum betiğini çalıştırın:
   ```
   curl -fsSL https://raw.githubusercontent.com/furrmaz/youtube-shorts-otomasyon/main/deploy/kurulum.sh -o kurulum.sh
   bash kurulum.sh
   ```
   Betik alan adını ve panel şifresini sorar. Docker'ı, güvenlik duvarını (sadece SSH/80/443 açık), takas alanını ve gece yedeğini kurar, uygulamayı derleyip başlatır.
5. Tarayıcıda `https://panel.siteniz.com` adresini açıp şifreyle girin. API anahtarlarını **Ayarlar → API anahtarları**'na girin.

## Google / YouTube bağlantısı

Google Cloud Console → Credentials → OAuth client → **Authorized redirect URIs** listesine şunu ekleyin:

```
https://panel.siteniz.com/api/youtube/callback
```

Panelde **Ayarlar → API anahtarları → Uygulama adresi** alanı doluysa (ör. `http://localhost:3000`) onu silin ya da `https://panel.siteniz.com` yapın; panelde girilen değer önceliklidir. Sonra kanalı yeniden bağlayın. TikTok/Instagram yönlendirme adresleri için de aynı alan adını kullanın.

## Bilgisayarınızdaki verileri taşımak (isteğe bağlı)

Kanallarınız, ayarlarınız ve takviminiz bilgisayarınızdaki `prisma\dev.db` dosyasında. Taşımak için uygulamayı kapatın, sonra bilgisayarınızda PowerShell'de:

```
scp prisma\dev.db root@SUNUCU_IP:/opt/shorts/data/shorts.db
scp -r media root@SUNUCU_IP:/opt/shorts/data/
scp -r music root@SUNUCU_IP:/opt/shorts/data/
```

Sunucuda `cd /opt/shorts && docker compose restart app`. Video dosya yolları bilgisayarınıza göre kayıtlı olduğu için eski videoların önizlemesi görünmeyebilir; yeni üretilenler sorunsuz çalışır. Aynı anda iki yerde çalıştırmayın, iki zamanlayıcı aynı videoları iki kez yükler.

## Günlük kullanım

| İş | Komut (sunucuda) |
|---|---|
| Güncelleme (yeni sürüm çıkınca) | `bash /opt/shorts/deploy/guncelle.sh` |
| Kayıtları izlemek | `cd /opt/shorts && docker compose logs -f app` |
| Yeniden başlatmak | `cd /opt/shorts && docker compose restart app` |
| Durdurmak / başlatmak | `docker compose down` / `docker compose up -d` |
| Elle yedek | `bash /opt/shorts/deploy/yedekle.sh` |
| Arka plan müziği eklemek | mp3'leri `/opt/shorts/data/music/` klasörüne kopyalayın |

Panelin üstündeki "yeni sürüm" uyarısı sunucuda görünmez; güncellemeyi yukarıdaki komutla siz başlatırsınız. Güncelleme önce veritabanını yedekler.

## Veriler nerede

```
/opt/shorts/data/shorts.db     kanallar, ayarlar, anahtarlar, takvim
/opt/shorts/data/media/        üretilen videolar, sesler, görseller
/opt/shorts/data/music/        arka plan müzikleri
/opt/shorts/backups/           gece yedekleri (son 14 gün)
```

Videolar diski doldurursa eski `media` klasörlerini silebilirsiniz (YouTube'a yüklenmiş videolar etkilenmez). Diski takip etmek için: `df -h /`. Videoları da yedeklemek isterseniz Hetzner **Storage Box** alıp `rsync -a /opt/shorts/data/media/ u12345@u12345.your-storagebox.de:media/` ile kopyalayabilirsiniz.

## İzleme

`https://panel.siteniz.com/api/health` adresi panel, veritabanı ve zamanlayıcı çalışıyorsa `200` döner, değilse `503`. Docker bunu dakikada bir kontrol eder. Ücretsiz **UptimeRobot** gibi bir servise bu adresi ekleyip uygulama durursa e-posta alabilirsiniz.

## Güvenlik notları

- Panel şifresi zorunludur (`/opt/shorts/.env` içindeki `PANEL_PASSWORD`). Panelden ayrı bir şifre girerseniz o geçerli olur.
- `.env` ve `data/` klasörü API anahtarlarınızı içerir; kimseyle paylaşmayın.
- Ubuntu güvenlik güncellemeleri `unattended-upgrades` ile otomatik kurulur.

## Docker olmadan (ileri düzey)

Node.js 22 ve ffmpeg kuruluysa `npm ci && npx prisma db push && npx next build` sonrasında `NO_BROWSER=1 PANEL_PASSWORD=... node scripts/start-all.mjs` komutunu bir systemd servisi olarak çalıştırabilirsiniz. Docker yolu daha az bakım ister, önerilen odur.
