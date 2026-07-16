import sources from "../config/sources.json" with { type: "json" };
import watchlist from "../config/watchlist.json" with { type: "json" };
import { extractArticlePublishedAt, extractEvents, extractPublishedAtFromText } from "../lib/extract.mjs";
import { readJson, writeJson } from "../lib/io.mjs";
import { hash, severityFor } from "../lib/text.mjs";
import { notifyDiscord } from "../lib/discord.mjs";
import { enrichWithOpenAISummaries } from "../lib/openai-summary.mjs";

const DATA_DIR = new URL("../data/", import.meta.url);
const now = new Date().toISOString();
const fresh = process.argv.includes("--fresh");
const previousEvents = fresh ? [] : await readJson(new URL("events.json", DATA_DIR), []);
const state = fresh ? { sources: {} } : await readJson(new URL("state.json", DATA_DIR), { sources: {} });
const previousByFingerprint = new Map(previousEvents.map((event) => [event.fingerprint, event]));
const previousBySourceUrl = new Map(
  previousEvents
    .filter((event) => event.sourceId && event.sourceUrl)
    .map((event) => [`${event.sourceId}|${event.sourceUrl}`, event])
);
const consumedPrevious = new Set();
const consumedSourceUrls = new Set();
const collectedEvents = [];
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
    const extracted = await enrichExtractedEvents(source, extractEvents(source, html));
    if (extracted.length === 0 && !source.allowEmpty) throw new Error("Parser returned zero events");

    for (const event of extracted) {
      const watched =
        watchlist.platforms.includes(event.platform) ||
        event.modelIds.some((id) => watchlist.models.includes(id));
      event.watched = watched;
      event.severity = severityFor(event.kind, `${event.title} ${event.summary}`, watched);
      const previous =
        previousByFingerprint.get(event.fingerprint) ||
        previousBySourceUrl.get(`${event.sourceId}|${event.sourceUrl}`);
      if (previous) {
        consumedPrevious.add(previousKey(previous));
        consumedSourceUrls.add(`${event.sourceId}|${event.sourceUrl}`);
        collectedEvents.push(mergeExistingEvent(event, previous));
      } else {
        newEvents.push(event);
        collectedEvents.push(event);
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
  routed: summaryResult.routed || 0,
  calls: summaryResult.calls || 0,
  failed: summaryResult.failed || 0,
  candidates: summaryResult.candidates || 0,
  skipped: summaryResult.skipped,
  model: summaryResult.model || null,
  fatalError: summaryResult.fatalError || null
};
const summaryStrict = process.env.SUMMARY_STRICT !== "false";
if (summaryStrict && newEvents.length > 0 && summaryResult.skipped) {
  run.summaryStatus = "blocked";
  run.summaryMessage = `OPENAI_API_KEY is required to summarize ${newEvents.length} new events.`;
  console.error(`${run.summaryMessage} Skipping data write so unsummarized events are not published.`);
  logSkippedPublish(run);
  process.exit(0);
}
if (
  summaryStrict &&
  !summaryResult.skipped &&
  summaryResult.candidates > 0 &&
  summaryResult.summarized === 0
) {
  run.summaryStatus = "blocked";
  run.summaryMessage = `OpenAI summaries failed for all ${summaryResult.candidates} candidate events; refusing to publish unsummarized data.`;
  console.error(`${run.summaryMessage}${summaryResult.fatalError ? ` Last error: ${summaryResult.fatalError}` : ""}`);
  logSkippedPublish(run);
  process.exit(0);
}
const retainedPrevious = await enrichCarriedEvents(previousEvents.filter(
  (event) => !consumedPrevious.has(previousKey(event)) && !consumedSourceUrls.has(`${event.sourceId}|${event.sourceUrl}`)
));
const merged = [...collectedEvents, ...retainedPrevious]
  .map(normalizeCarriedEvent)
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

function logSkippedPublish(run) {
  run.completedAt = new Date().toISOString();
  console.log(
    JSON.stringify({
      sources: sources.length,
      succeeded: Object.values(run.sources).filter((item) => item.ok).length,
      newEvents: run.newEvents,
      summaryStatus: run.summaryStatus,
      published: false
    })
  );
}

function eventSortTime(event) {
  const published = event.publishedAt ? new Date(event.publishedAt) : null;
  if (published && !Number.isNaN(published.valueOf()) && !isFutureDate(published)) {
    return published.valueOf();
  }
  const detected = event.detectedAt ? new Date(event.detectedAt) : null;
  return detected && !Number.isNaN(detected.valueOf()) ? detected.valueOf() : 0;
}

function previousKey(event) {
  return `${event.sourceId}|${event.sourceUrl || ""}|${event.fingerprint || event.id || ""}`;
}

function normalizeCarriedEvent(event) {
  if (event.publishedAt || event.sourceId === "bedrock-lifecycle") return event;
  const publishedAt = extractPublishedAtFromText(`${event.title || ""}\n${event.summary || ""}`);
  return publishedAt ? { ...event, publishedAt } : event;
}

async function enrichExtractedEvents(source, events) {
  if (!["anthropic-news", "gemini-news"].includes(source.id)) return events;
  return Promise.all(
    events.map((event) => enrichNewsDateIfMissing(event))
  );
}

async function enrichCarriedEvents(events) {
  return Promise.all(
    events.map((event) =>
      ["anthropic-news", "gemini-news"].includes(event.sourceId) ? enrichNewsDateIfMissing(event) : event
    )
  );
}

async function enrichNewsDateIfMissing(event) {
  if (event.publishedAt || !event.sourceUrl) return event;
  try {
    const response = await fetch(event.sourceUrl, {
      headers: {
        "user-agent": "AIModelBrief/0.1 (+https://github.com/Cheeseorim/ai-model-brief)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) return event;
    const publishedAt = extractArticlePublishedAt(await response.text());
    if (publishedAt) return { ...event, publishedAt };
  } catch {
    // Detail-page dates are a best-effort enhancement; the list item remains usable.
  }
  return event;
}

function mergeExistingEvent(next, previous) {
  return {
    ...previous,
    ...next,
    id: previous.id || next.id,
    detectedAt: previous.detectedAt || next.detectedAt,
    titleKo: previous.titleKo,
    summaryKo: previous.summaryKo,
    impactKo: previous.impactKo,
    actionKo: previous.actionKo,
    whoShouldCareKo: previous.whoShouldCareKo,
    urgency: previous.urgency || next.urgency,
    changeType: previous.changeType || next.changeType,
    confidence: previous.confidence || next.confidence,
    isProbablyNoise: previous.isProbablyNoise ?? next.isProbablyNoise,
    clusterKey: previous.clusterKey || next.clusterKey,
    routes: previous.routes || next.routes,
    briefKo: previous.briefKo,
    summaryMeta: previous.summaryMeta,
    summaryError: previous.summaryError
  };
}

function isFutureDate(date) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return date >= tomorrow;
}
