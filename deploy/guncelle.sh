#!/usr/bin/env bash
# Sunucudaki uygulamayı GitHub'daki son sürüme günceller. Veriler (data/) korunur.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "=== Yedek alınıyor ==="
bash deploy/yedekle.sh || echo "(yedek alınamadı, devam ediliyor)"
echo "=== Son sürüm indiriliyor ==="
git pull --ff-only origin main
echo "=== Derleniyor ve yeniden başlatılıyor ==="
docker compose up -d --build
docker image prune -f >/dev/null
echo "✓ Güncellendi. Kayıtlar: docker compose logs -f app"
