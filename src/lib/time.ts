// Saat dilimi yardımcıları (harici kütüphane olmadan, Intl ile)

function tzOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - at.getTime();
}

/** "2026-11-14" + "18:00" (tz yerel saati) -> UTC Date */
export function zonedToUtc(dateYmd: string, timeHm: string, tz: string): Date {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const [hh, mm] = timeHm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffsetMs(tz, new Date(guess));
  t = guess - tzOffsetMs(tz, new Date(t)); // DST geçişleri için ikinci tur
  return new Date(t);
}

/** UTC Date -> tz yerel "YYYY-MM-DD" */
export function ymdInTz(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function formatLocal(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(at);
}

export function parsePublishTimes(s: string): string[] {
  const times = s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^\d{1,2}:\d{2}$/.test(x))
    .map((x) => x.padStart(5, "0"));
  return times.length ? times : ["18:00"];
}

/** <input type="datetime-local"> için tz yerel "YYYY-MM-DDTHH:MM" */
export function toLocalInput(at: Date, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
