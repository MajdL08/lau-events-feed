/* Scrape LAU university events and write public/lau-events.json.
   Run by .github/workflows/sync-lau-events.yml every 30 min.
   Uses the same parser as server/lauEvents.js so the JSON shape matches /api/lau-events. */
import { writeFileSync } from "node:fs";
import { fetchLauFeed } from "../server/lauEvents.js";

const out = { source: "eventscal", fetchedAt: new Date().toISOString(), events: [], total: 0, skipped: 0 };

try {
  const { events, skipped } = await fetchLauFeed();
  out.events = events;
  out.total = events.length;
  out.skipped = skipped;
} catch (e) {
  out.error = String(e?.message ?? e);
}

writeFileSync(new URL("../public/lau-events.json", import.meta.url), JSON.stringify(out));
console.log(`wrote lau-events.json: ${out.total} events, ${out.skipped} skipped${out.error ? `, ERROR: ${out.error}` : ""}`);
