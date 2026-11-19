#!/usr/bin/env bash
# Hetzner (veya herhangi bir Ubuntu 22.04/24.04) sunucuda tek seferlik kurulum.
# Kullanım (sunucuya root olarak bağlanınca):
#   curl -fsSL https://raw.githubusercontent.com/furrmaz/youtube-shorts-otomasyon/main/deploy/kurulum.sh -o kurulum.sh
#   bash kurulum.sh
set -euo pipefail

REPO="${REPO:-https://github.com/furrmaz/youtube-shorts-otomasyon.git}"
DIR="${DIR:-/opt/shorts}"

if [ "$(id -u)" != "0" ]; then echo "Bu betiği root olarak çalıştırın (sudo bash kurulum.sh)"; exit 1; fi

echo "=== 1/6 Paketler kuruluyor (Docker, git, güvenlik duvarı) ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git ufw sqlite3 unattended-upgrades
if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y docker.io
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-v2 || apt-get install -y docker-compose-plugin
fi
systemctl enable --now docker

echo "=== 2/6 Güvenlik duvarı: sadece SSH, HTTP, HTTPS açık ==="
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable

echo "=== 3/6 Takas alanı (küçük sunucularda derleme ve montaj için) ==="
if ! swapon --show | grep -q .; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "4 GB takas alanı eklendi"
else
  echo "Takas alanı zaten var"
fi

echo "=== 4/6 Proje indiriliyor: $DIR ==="
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO" "$DIR"
fi
cd "$DIR"

echo "=== 5/6 Ayarlar ==="
if [ ! -f .env ]; then
  read -rp "Panelin alan adı (ör. panel.siteniz.com): " DOMAIN
  while true; do
    read -rsp "Panel şifresi (en az 8 karakter): " PW; echo
    [ ${#PW} -ge 8 ] && break
    echo "Şifre çok kısa."
  done
  read -rp "Saat dilimi [Europe/Istanbul]: " TZV
  cat > .env <<ENV
DOMAIN=$DOMAIN
PANEL_PASSWORD=$PW
TZ=${TZV:-Europe/Istanbul}
ENV
  chmod 600 .env
  echo ".env oluşturuldu"
else
  echo ".env zaten var, olduğu gibi kullanılıyor"
fi
mkdir -p data/media data/music backups

echo "=== 6/6 Uygulama derlenip başlatılıyor (ilk sefer 5-10 dk sürebilir) ==="
docker compose up -d --build

# Her gece 04:00te veritabanı yedeği
CRON=/etc/cron.d/shorts-yedek
echo "0 4 * * * root bash $DIR/deploy/yedekle.sh >> /var/log/shorts-yedek.log 2>&1" > "$CRON"
chmod 644 "$CRON"

. ./.env
echo
echo "✓ Kurulum tamamlandı."
echo "  Panel:   https://$DOMAIN   (sertifika ilk açılışta 1-2 dk içinde alınır)"
echo "  Kayıtlar: cd $DIR && docker compose logs -f app"
echo "  Güncelleme: bash $DIR/deploy/guncelle.sh"
echo "  Google OAuth yönlendirme adresi: https://$DOMAIN/api/youtube/callback"
