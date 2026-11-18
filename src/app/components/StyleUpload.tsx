"use client";
import { useState } from "react";

/** Örnek video yükleme (ilerleme çubuklu); bitince sayfa yenilenir ve çözümleme durumu görünür */
export function StyleUpload({ channelId, hasRef }: { channelId: string; hasRef: boolean }) {
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState("");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) return setErr("Bir video seçin");
    setErr("");
    const q = new URLSearchParams({ channel: channelId, name: file.name, note: String(f.get("note") ?? "") });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/style/upload?${q}`);
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setPct(Math.round((ev.loaded / ev.total) * 100));
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText) as { ok?: boolean; error?: string };
        if (!j.ok) throw new Error(j.error || `HTTP ${xhr.status}`);
        window.location.reload();
      } catch (x) {
        setErr((x as Error).message);
        setPct(null);
      }
    };
    xhr.onerror = () => {
      setErr("Bağlantı hatası");
      setPct(null);
    };
    xhr.send(file);
    setPct(0);
  }

  return (
    <form onSubmit={submit}>
      <label style={{ marginTop: 0 }}>{hasRef ? "Başka bir örnek video yükle" : "Örnek video (MP4, MOV; en fazla 10 dakika)"}</label>
      <input type="file" name="file" accept="video/*" />
      <label>Not (isteğe bağlı): örnekte özellikle neyi kopyalamak istiyorsun?</label>
      <input name="note" placeholder="ör. açılıştaki soru kalıbı ve hızlı kesmeler, renkler önemli değil" />
      <div className="row" style={{ marginTop: 12 }}>
        <button disabled={pct !== null}>{pct === null ? "Yükle ve çözümle" : `Yükleniyor %${pct}`}</button>
        {err && <span className="err">{err}</span>}
      </div>
    </form>
  );
}
