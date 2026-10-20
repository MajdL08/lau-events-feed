/* LAU university events from eventscal.lau.edu.lb, for GET /api/lau-events (see server/live.js).

   Source: https://eventscal.lau.edu.lb/rss/ . Depending on how it's requested, LAU serves it as RSS/Atom XML
   (<item>/<entry>) or as a small HTML list of event.php?evt=... links. Both are parsed here, nothing else:
     title    the item/link title, exactly as LAU prints it
     when     "Oct 20–24, 2026 8:30 AM–4:30 PM" style text -> Beirut wall-clock start/end (LAU writes "23:59"
              as the end when an event has no end time, so that end is treated as "not given")
     location the text after the date/time (or a <location>-style tag)
     url      the LAU detail page (https, LAU hosts only)
     category <category> tags when the feed has them, otherwise null
   Dedup key: the evt= id from the detail URL. Items without a parseable date are skipped and counted,
   never guessed. A feed with items where nothing parses is an error (format changed), not "no events". */
import { beirutInputToMs } from "../src/lib/format.js";

export const LAU_FEED_URL = "https://eventscal.lau.edu.lb/rss/";
const LAU_HOST = /(^|\.)lau\.edu\.lb$/i;

export class LauFeedError extends Error {}

let fetchImpl = (...a) => fetch(...a);
export const setLauFetch = (f) => {
  fetchImpl = f;
};

/* ---------------- text helpers ---------------- */
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", bull: "•", middot: "·", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç" };
export const decode = (s) =>
  String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
const uncdata = (s) => String(s ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
// HTML fragment -> trimmed lines of plain text (<br>, </p>, </li>, </div> ... become line breaks)
export const toLines = (html) =>
  decode(
    String(html ?? "")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|dd|dt|h\d|tr|span)>|<(p|div|li|dd|dt|tr)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((l) => l.replace(/[\s\u00a0]+/g, " ").trim())
    .filter(Boolean);
const textOf = (html) => toLines(html).join(" ").trim();

/* ---------------- date + time ---------------- */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";
const DASH = "\\s*[–—-]\\s*";
// Oct 19, 2026 · Oct 20–24, 2026 · Oct 30–Nov 2, 2026 · Dec 30, 2026–Jan 2, 2027 · October 23, 2026
const DATE_RE = new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?(?:${DASH}(?:${MON}\\s+)?(\\d{1,2}))?,?\\s+(\\d{4})\\b`, "i");
const T = "(\\d{1,2}(?::\\d{2})?\\s*[ap]\\.?\\s?m\\.?|\\d{1,2}:\\d{2}|noon|midnight)";
const TIME_RE = new RegExp(`^[\\s,·|@]*${T}(?:${DASH}${T})?`, "i");
const ALLDAY_RE = /^[\s,·|]*all[\s-]?day\b/i;

const pad = (n) => String(n).padStart(2, "0");
const month = (m) => MONTHS.indexOf(m.slice(0, 3).toLowerCase());
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const validDay = (y, m, d) => m >= 0 && d >= 1 && d <= new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

// "2:45 PM" | "14:45" | "noon" -> "14:45" (null when it isn't a real time)
export function toHHMM(raw) {
  const t = raw.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
  if (t === "noon") return "12:00";
  if (t === "midnight") return "00:00";
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = +m[1];
  const mm = m[2] == null ? 0 : +m[2];
  if (mm > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === "pm" ? 12 : 0);
  } else if (m[2] == null || h > 23) return null; // a bare "7" is not a time
  return `${pad(h)}:${pad(mm)}`;
}

/* Finds LAU's date (+ optional time) in a text. Returns null when there is no full date with a year.
   { startDate, endDate, startTime, endTime, allDay, rest } -- rest = the text after the date/time. */
export function parseWhen(text) {
  const s = String(text ?? "");
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [, m1, d1, y1, m2, d2, y] = m;
  const mo1 = month(m1);
  const mo2 = m2 ? month(m2) : mo1;
  const endYear = +y;
  const startYear = y1 ? +y1 : d2 && mo2 < mo1 ? endYear - 1 : endYear; // "Dec 30–Jan 2, 2027"
  if (!validDay(startYear, mo1, +d1)) return null;
  const startDate = iso(startYear, mo1, +d1);
  const endDate = d2 ? iso(endYear, mo2, +d2) : startDate;
  if (d2 && !validDay(endYear, mo2, +d2)) return null;
  if (endDate < startDate) return null;
  let after = s.slice(m.index + m[0].length);
  let startTime = null;
  let endTime = null;
  let allDay = false;
  const t = TIME_RE.exec(after);
  if (t && toHHMM(t[1])) {
    startTime = toHHMM(t[1]);
    endTime = t[2] ? toHHMM(t[2]) : null;
    if (endTime === "23:59") endTime = null; // LAU's "no end time"
    after = after.slice(t[0].length);
  } else if (ALLDAY_RE.test(after)) {
    allDay = true;
    after = after.replace(ALLDAY_RE, "");
  } else allDay = true;
  return { startDate, endDate, startTime, endTime, allDay, before: s.slice(0, m.index), rest: after.replace(/^[\s,·|–—-]+/, "").trim() };
}

/* ---------------- items ---------------- */
const tagRe = (name, flags = "i") => new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, flags);
const tag = (xml, name) => uncdata(tagRe(name).exec(xml)?.[1] ?? "");
const tags = (xml, name) => [...xml.matchAll(tagRe(name, "gi"))].map((m) => uncdata(m[1]));
const attr = (xml, name, a) => new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*\\b${a}="([^"]*)"`, "i").exec(xml)?.[1] ?? "";

export function evtId(url) {
  const m = /[?&]evt=([^&#"'\s<>]+)/i.exec(decode(url ?? ""));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

// Only LAU pages get a "View on LAU site" link. http -> https on LAU hosts.
export function lauUrl(raw, id) {
  const fromId = id ? `https://eventscal.lau.edu.lb/event.php?evt=${encodeURIComponent(id)}` : null;
  try {
    const u = new URL(decode(raw ?? "").trim(), LAU_FEED_URL);
    if ((u.protocol === "http:" || u.protocol === "https:") && LAU_HOST.test(u.hostname)) {
      u.protocol = "https:";
      return u.toString();
    }
  } catch {
    /* fall through */
  }
  return fromId;
}

const CAMPUSES = [
  ["Byblos", /byblos|jbeil/i],
  ["Beirut", /beirut|rizk|saint john|gezairi|nicol|aksob|irwin|gulbenkian/i],
  ["New York", /new york|\bnyc\b/i],
  ["Online", /online|webex|zoom|teams/i],
];
export const campusesOf = (location) => CAMPUSES.filter(([, re]) => re.test(location ?? "")).map(([name]) => name);

const toEvent = ({ title, link, when, location, categories }) => {
  const id = evtId(link);
  const start = beirutInputToMs(when.startDate, when.startTime ?? "00:00");
  // no end time given: the event runs until the end of its last day (used only to decide "still upcoming")
  const end = beirutInputToMs(when.endDate, when.endTime ?? "23:59");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const cats = [...new Set(categories.map((c) => textOf(c)).filter(Boolean))];
  return {
    id: id ?? null,
    title,
    start: new Date(start).toISOString(),
    end: new Date(Math.max(end, start)).toISOString(),
    startDate: when.startDate,
    endDate: when.endDate,
    startTime: when.startTime,
    endTime: when.endTime,
    allDay: when.allDay,
    location: location || null,
    campuses: campusesOf(location),
    url: lauUrl(link, id),
    category: cats.length ? cats.join(" · ") : null,
    categories: cats,
    organizer: "LAU",
  };
};

const SKIP = new Set(["title", "link", "guid", "category", "pubdate", "published", "updated", "author", "creator", "comments", "source", "enclosure", "id"]);
function fromXmlItem(xml) {
  const title = textOf(tag(xml, "title"));
  const link = textOf(tag(xml, "link")) || attr(xml, "link", "href") || textOf(tag(xml, "guid")) || textOf(tag(xml, "id"));
  const categories = [...tags(xml, "category"), ...[...xml.matchAll(/<(?:[\w-]+:)?category\b[^>]*\bterm="([^"]*)"/gi)].map((m) => m[1])];
  const desc = decode(tag(xml, "description") || tag(xml, "summary") || tag(xml, "encoded") || tag(xml, "content"));
  const structuredLoc = textOf(decode(tag(xml, "location") || tag(xml, "venue") || tag(xml, "place")));
  // date: from the description text first, then any other element (e.g. a custom <ev:startdate>)
  const descLines = toLines(desc);
  let when = parseWhen(descLines.join("\n"));
  let rest = when ? when.rest : "";
  if (!when) {
    const leaves = [...xml.matchAll(/<((?:[\w-]+:)?([\w-]+))\b[^>]*>([^<]*(?:<!\[CDATA\[[\s\S]*?\]\]>[^<]*)?)<\/\1>/gi)]
      .filter((m) => !SKIP.has(m[2].toLowerCase()))
      .map((m) => textOf(decode(uncdata(m[3]))))
      .filter(Boolean);
    when = parseWhen(leaves.join("\n")) ?? parseWhen(title);
    rest = "";
  }
  if (!title || !when) return null;
  const location = structuredLoc || rest.split("\n").map((l) => l.trim()).filter(Boolean).join(" · ");
  return { title, link, when, location, categories };
}

function fromHtml(html) {
  const out = [];
  const anchors = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']*evt=[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  anchors.forEach((a, i) => {
    const endAt = i + 1 < anchors.length ? anchors[i + 1].index : html.length;
    let tail = html.slice(a.index + a[0].length, endAt);
    const close = tail.search(/<\/li>|<\/tr>|<\/article>/i);
    if (close >= 0) tail = tail.slice(0, close);
    const title = textOf(a[2]);
    const lines = toLines(tail);
    const when = parseWhen(lines.join("\n"));
    if (!title || !when) return out.push(null);
    const cats = [...tail.matchAll(/<[^>]+class="[^"]*\b(?:category|categories|cat|tag)\b[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/gi)].map((m) => m[1]);
    const location = when.rest.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !cats.some((c) => textOf(c) === l)).join(" · ");
    out.push({ title, link: a[1], when, location, categories: cats });
  });
  return out;
}

/* Feed text -> { events, items, skipped }. Throws LauFeedError when the text isn't an LAU events feed. */
export function parseLauFeed(text) {
  const body = String(text ?? "");
  const isFeed = /<(rss|feed|rdf:RDF|channel)\b/i.test(body);
  const xmlItems = body.match(/<item\b[\s\S]*?<\/item>/gi) ?? body.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const raw = xmlItems.length ? xmlItems.map(fromXmlItem) : fromHtml(body);
  if (!raw.length && !isFeed) throw new LauFeedError("no events found in the LAU feed (format not recognized)");
  const parsed = raw.filter(Boolean).map(toEvent).filter(Boolean);
  if (raw.length && !parsed.length) throw new LauFeedError(`none of ${raw.length} LAU feed items had a readable date`);
  const seen = new Map();
  for (const e of parsed) {
    const key = e.id ?? e.url ?? `${e.title}|${e.start}`;
    const first = seen.get(key);
    if (!first) seen.set(key, e);
    else // same evt= listed twice: keep the first, fill only what it was missing
      for (const k of ["location", "category", "url"]) if (first[k] == null && e[k] != null) Object.assign(first, k === "location" ? { location: e.location, campuses: e.campuses } : k === "category" ? { category: e.category, categories: e.categories } : { url: e.url });
  }
  const events = [...seen.values()].sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return { events, items: raw.length, skipped: raw.length - parsed.length };
}

export const isByblos = (e) => e.campuses.includes("Byblos");

export async function fetchLauFeed({ timeoutMs = 15000 } = {}) {
  let res;
  try {
    res = await fetchImpl(LAU_FEED_URL, {
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new LauFeedError(`eventscal.lau.edu.lb did not answer (${e?.name === "TimeoutError" ? "timeout" : (e?.message ?? e)})`);
  }
  if (!res.ok) throw new LauFeedError(`eventscal.lau.edu.lb answered HTTP ${res.status}`);
  return parseLauFeed(await res.text());
}
