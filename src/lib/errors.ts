/** Ham API hata metinlerini anlaşılır Türkçeye çevirir */
export function friendlyError(msg: string): string {
  if (/authentication_error|invalid x-api-key|^401\b.*anthropic|x-api-key/i.test(msg)) return "Claude API anahtarı geçersiz (Ayarlar → API anahtarları).";
  if (/credit balance/i.test(msg)) return "Claude hesabında kredi yok (console.anthropic.com → Billing).";
  if (/overloaded|^529\b/i.test(msg)) return "Claude şu an çok yoğun; birkaç dakika sonra tekrar deneyin.";
  if (/^429\b|rate.?limit/i.test(msg)) return "Kullanım sınırına takıldı; biraz sonra tekrar deneyin.";
  if (/quota_exceeded|insufficient.*(credit|quota)/i.test(msg) && /eleven/i.test(msg)) return "ElevenLabs karakter kotası doldu.";
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|ETIMEDOUT/i.test(msg)) return `İnternet bağlantısı sorunu: ${msg.slice(0, 120)}`;
  // JSON gövdeli hatalarda sadece "message" kısmını göster
  const m = msg.match(/"message"\s*:\s*"([^"]{3,300})"/);
  return m ? `${msg.split("{")[0].trim()} ${m[1]}`.trim() : msg;
}
