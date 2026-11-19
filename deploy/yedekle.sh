#!/usr/bin/env bash
# Veritabanının (kanallar, ayarlar, anahtarlar, takvim) tutarlı yedeği. Son 14 yedek saklanır.
# Videolar (data/media) büyük olduğu için yedeklenmez; gerekirse Hetzner Storage Box'a rsync ile alın (SUNUCU.md).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
DB=data/shorts.db
[ -f "$DB" ] || { echo "Veritabanı yok: $DB"; exit 0; }
OUT="backups/shorts-$(date +%Y%m%d-%H%M).db"
sqlite3 "$DB" ".backup '$OUT'"
gzip -f "$OUT"
ls -1t backups/shorts-*.db.gz | tail -n +15 | xargs -r rm -f
echo "$(date '+%F %T') yedek: $OUT.gz"
