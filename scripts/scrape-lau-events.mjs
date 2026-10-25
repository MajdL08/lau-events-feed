/* Scrape LAU university events and write public/lau-events.json.
   Run by .github/workflows/sync-lau-events.yml every 30 min.
   Uses the same parser as server/lauEvents.js so the JSON shape matches /api/lau-events.

   Safety rule (learned Oct 23, 2026, when a source timeout overwrote the file with an
   empty list and both apps went blank): a failed or suspicious run NEVER touches the
   existing file. The previous good data stays live until a healthy run replaces it. */
import { readFileSync, writeFileSync } from "node:fs";
import { fetchLauFeed } from "../server/lauEvents.js";

const outUrl = new URL("../public/lau-events.json", import.meta.url);

let prevTotal = 0;
try {
  prevTotal = JSON.parse(readFileSync(outUrl, "utf8")).total ?? 0;
} catch {
  /* no readable previous file: nothing to protect */
}

let result;
try {
  result = await fetchLauFeed();
} catch (e) {
  console.error(`LAU events fetch FAILED: ${e?.message ?? e} — keeping the previous file (${prevTotal} events) untouched.`);
  process.exit(0);
}

const { events, skipped } = result;

if (!events.length && prevTotal > 0) {
  console.error(`LAU events fetch returned 0 events (previous file has ${prevTotal}) — keeping the previous file untouched.`);
  process.exit(0);
}
if (prevTotal >= 8 && events.length < prevTotal / 2) {
  console.error(`LAU events count dropped suspiciously (${prevTotal} -> ${events.length}) — keeping the previous file untouched.`);
  process.exit(0);
}

const out = { source: "eventscal", fetchedAt: new Date().toISOString(), events, total: events.length, skipped };
writeFileSync(outUrl, JSON.stringify(out));
console.log(`wrote lau-events.json: ${out.total} events, ${out.skipped} skipped`);
