export const num = (n) => n.toLocaleString("en-US");

export function ago(ts, now = Date.now()) {
  const m = Math.max(1, Math.round((now - ts) / 60000));
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return beirut(ts, { month: "long", day: "numeric" });
}
export const agoShort = (ts, now = Date.now()) => {
  const m = Math.max(1, Math.round((now - ts) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};

// Every date in the app is displayed in Asia/Beirut.
export const beirut = (ts, opts) => new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Beirut", ...opts }).format(ts);
export const beirutTime = (ts) => beirut(ts, { hour: "numeric", minute: "2-digit" });
export const beirutDay = (ts) => beirut(ts, { weekday: "short", month: "short", day: "numeric" });

/* <input type="date"> / <input type="time"> values are Beirut wall-clock time, whatever the phone's zone.
   Converts both ways with Intl only (DST-safe: Lebanon switches offset in March and October). */
const beirutParts = (ms) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Beirut", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(ms)
      .map((p) => [p.type, p.value])
  );
const beirutOffset = (ms) => {
  const p = beirutParts(ms);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(ms / 60000) * 60000;
};
export function beirutInputToMs(date, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  const t = /^(\d{2}):(\d{2})$/.exec(time ?? "");
  if (!d || !t) return NaN;
  const wall = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  const first = wall - beirutOffset(wall);
  return wall - beirutOffset(first);
}
export function msToBeirutInput(ms) {
  const p = beirutParts(ms);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${String(+p.hour % 24).padStart(2, "0")}:${p.minute}` };
}
