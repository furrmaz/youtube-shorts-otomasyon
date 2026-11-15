"use client";
import { useState } from "react";

/** Demo videosu yükleme formu (ilerleme çubuklu, dosya parça parça sunucuya akar) */
export function ClipUpload({ channelId }: { channelId: string }) {
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState("");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) return setErr("Bir video seçin");
    setErr("");
    const q = new URLSearchParams({
      channel: channelId,
      name: file.name,
      narrate: f.get("narrate") === "on" ? "1" : "0",
      seconds: String(f.get("seconds") ?? "35"),
      publish: f.get("publish") === "on" ? "1" : "0",
      note: String(f.get("note") ?? ""),
    });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/upload?${q}`);
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setPct(Math.round((ev.loaded / ev.total) * 100));
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText) as { id?: string; error?: string };
        if (j.id) window.location.href = `/items/${j.id}`;
        else throw new Error(j.error || `HTTP ${xhr.status}`);
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
    <form onSubmit={submit} className="card">
      <h2 style={{ marginTop: 0 }}>Demo videosu yükle</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Sitedeki yatay demo videonuzu (ekran kaydı vb.) yükleyin. Claude videodan kareler ve konuşma dökümüyle en çarpıcı anları seçer,
        kanca ve kısa anlatım yazar; dikey 9:16 klip, altyazı, müzik ve kanal logosuyla hazırlanır.
      </p>
      <input type="file" name="file" accept="video/*" />
      <div className="two">
        <div>
          <label>Hedef süre (saniye)</label>
          <input type="number" name="seconds" min={15} max={60} defaultValue={35} />
        </div>
        <div>
          <label>Not (isteğe bağlı)</label>
          <input name="note" placeholder="ör. randevu ekranını mutlaka göster" />
        </div>
      </div>
      <div className="checks">
        <label><input type="checkbox" name="narrate" /> Videonun kendi sesi yerine yeni seslendirme yap</label>
        <label><input type="checkbox" name="publish" /> Hazır olunca hemen yayınla</label>
      </div>
      <div className="muted">Videoda konuşma yoksa seslendirme otomatik yapılır.</div>
      <div className="row" style={{ marginTop: 12 }}>
        <button disabled={pct !== null}>{pct === null ? "Yükle ve klip yap" : `Yükleniyor %${pct}`}</button>
        {err && <span className="err">{err}</span>}
      </div>
    </form>
  );
}
