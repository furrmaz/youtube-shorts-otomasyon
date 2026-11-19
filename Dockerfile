# YouTube Shorts Otomasyon: panel + zamanlayıcı tek kapsayıcıda (7/24 sunucu kullanımı için)
FROM node:22-bookworm-slim

# ffmpeg: montaj · openssl: Prisma · fontlar: altyazı (Arial yerine metrik uyumlu Liberation Sans)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates curl fonts-liberation fonts-dejavu-core fontconfig \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npx prisma generate && npx next build

# Kalıcı veriler /data altında (docker-compose bir volume bağlar)
ENV NODE_ENV=production \
    PORT=3000 \
    NO_BROWSER=1 \
    DATABASE_URL="file:/data/shorts.db" \
    MEDIA_DIR=/data/media \
    MUSIC_DIR=/data/music \
    SUBTITLE_FONT="Liberation Sans"

EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

# Her açılışta veritabanı şeması güncellenir, sonra panel + zamanlayıcı başlar
CMD ["sh", "-c", "mkdir -p /data/media /data/music && npx prisma db push --skip-generate && node scripts/start-all.mjs"]
