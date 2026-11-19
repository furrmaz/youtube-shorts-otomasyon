"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Sayfa açıkken verileri belirli aralıklarla yeniler.
 * Eskiden <meta http-equiv="refresh"> kullanılıyordu; tarayıcı bu zamanlayıcıyı başka sayfaya
 * geçilse bile iptal etmediği için kullanıcı birkaç saniye sonra üretilen videonun sayfasına
 * geri atılıyordu. Bu bileşen sayfadan çıkılınca zamanlayıcıyı durdurur ve sadece veriyi yeniler.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
