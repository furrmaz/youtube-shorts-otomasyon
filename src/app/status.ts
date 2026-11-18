export const STATUS_TR: Record<string, string> = {
  WRITING: "Yazılıyor",
  DRAFT: "Taslak",
  APPROVED: "Onaylı",
  PRODUCING: "Üretiliyor",
  READY: "Hazır",
  UPLOADING: "Yükleniyor",
  UPLOADED: "Yüklendi",
  FAILED: "Hata",
};

/** Başarısız kayıtlarda kalan "(yazılıyor…)" ekini gösterme */
export const cleanTitle = (title: string, status: string) =>
  status === "WRITING" ? title : title.replace(/\s*\((yazılıyor|hazırlanıyor)…\)$/, "");

export { friendlyError } from "@/lib/errors";
