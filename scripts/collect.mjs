import sources from "../config/sources.json" with { type: "json" };
import watchlist from "../config/watchlist.json" with { type: "json" };
import { extractEvents } from "../lib/extract.mjs";
import { readJson, writeJson } from "../lib/io.mjs";
import { hash, severityFor } from "../lib/text.mjs";
import { notifyDiscord } from "../lib/discord.mjs";
import { enrichWithOpenAISummaries } from "../lib/openai-summary.mjs";

const DATA_DIR = new URL("../data/", import.meta.url);
const now = new Date().toISOString();
const fresh = process.argv.includes("--fresh");
const previousEvents = fresh ? [] : await readJson(new URL("events.json", DATA_DIR), []);
const state = fresh ? { sources: {} } : await readJson(new URL("state.json", DATA_DIR), { sources: {} });
const fingerprints = new Set(previousEvents.map((event) => event.fingerprint));
const newEvents = [];
const run = { startedAt: now, completedAt: null, sources: {}, newEvents: 0 };

for (const source of sources) {
  const started = Date.now();
  try {
    const response = await fetch(source.url, {
      headers: {
        "user-agent": "AIModelBrief/0.1 (+https://github.com/Cheeseorim/ai-model-brief)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const extracted = extractEvents(source, html);
    if (extracted.length === 0 && !source.allowEmpty) throw new Error("Parser returned zero events");

    for (const event of extracted) {
      const watched =
        watchlist.platforms.includes(event.platform) ||
        event.modelIds.some((id) => watchlist.models.includes(id));
      event.watched = watched;
      event.severity = severityFor(event.kind, `${event.title} ${event.summary}`, watched);
      if (!fingerprints.has(event.fingerprint)) {
        fingerprints.add(event.fingerprint);
        newEvents.push(event);
      }
    }

    const contentHash = hash(extracted.map((event) => event.fingerprint).join("|"));
    state.sources[source.id] = {
      ok: true,
      checkedAt: now,
      itemCount: extracted.length,
      contentHash,
      error: null
    };
    run.sources[source.id] = {
      ok: true,
      itemCount: extracted.length,
      durationMs: Date.now() - started
    };
  } catch (error) {
    state.sources[source.id] = {
      ...(state.sources[source.id] || {}),
      ok: false,
      checkedAt: now,
      error: error.message
    };
    run.sources[source.id] = {
      ok: false,
      error: error.message,
      durationMs: Date.now() - started
    };
    console.error(`${source.id}: ${error.message}`);
  }
}

state.lastRunAt = now;
run.completedAt = new Date().toISOString();
run.newEvents = newEvents.length;
const summaryResult = await enrichWithOpenAISummaries(newEvents);
run.summaries = {
  summarized: summaryResult.summarized,
  skipped: summaryResult.skipped,
  model: summaryResult.model || null
};
const merged = [...newEvents, ...previousEvents]
  .sort((a, b) => eventSortTime(b) - eventSortTime(a))
  .slice(0, 5000);

const runs = fresh ? [] : await readJson(new URL("runs.json", DATA_DIR), []);
await writeJson(new URL("events.json", DATA_DIR), merged);
await writeJson(new URL("state.json", DATA_DIR), state);
await writeJson(new URL("runs.json", DATA_DIR), [run, ...runs].slice(0, 90));
await notifyDiscord(newEvents, process.env.DISCORD_WEBHOOK_URL);

console.log(
  JSON.stringify({
    sources: sources.length,
    succeeded: Object.values(run.sources).filter((item) => item.ok).length,
    newEvents: newEvents.length
  })
);

function eventSortTime(event) {
  const published = event.publishedAt ? new Date(event.publishedAt) : null;
  if (published && !Number.isNaN(published.valueOf()) && !isFutureDate(published)) {
    return published.valueOf();
  }
  const detected = event.detectedAt ? new Date(event.detectedAt) : null;
  return detected && !Number.isNaN(detected.valueOf()) ? detected.valueOf() : 0;
}

function isFutureDate(date) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return date >= tomorrow;
}
