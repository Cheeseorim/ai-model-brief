import test from "node:test";
import assert from "node:assert/strict";
import { extractEvents } from "../lib/extract.mjs";
import { canonicalUrl, extractModelIds } from "../lib/text.mjs";

test("dated sections become normalized events", () => {
  const source = {
    id: "fixture",
    vendor: "test",
    platform: "api",
    kind: "changelog",
    parser: "dated-sections",
    url: "https://example.com/changelog"
  };
  const html = `
    <main>
      <h2>June 15, 2026</h2>
      <p>Deprecation announcement: gemini-2.0-flash shuts down August 17, 2026.</p>
      <h2>June 1, 2026</h2>
      <p>Released gemini-3.0-flash to general availability.</p>
    </main>`;
  const events = extractEvents(source, html);
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, "deprecation");
  assert.deepEqual(events[0].modelIds, ["gemini-2.0-flash"]);
  assert.equal(events[0].publishedAt, "2026-06-15");
});

test("tracking parameters are removed from canonical URLs", () => {
  assert.equal(
    canonicalUrl("https://example.com/a?utm_source=x&hl=ko&id=3#top"),
    "https://example.com/a?id=3"
  );
});

test("model ids are extracted across vendors", () => {
  assert.deepEqual(
    extractModelIds("Use gpt-5-mini, claude-sonnet-4-6 and anthropic.claude-3-v1:0"),
    ["gpt-5-mini", "claude-sonnet-4-6", "anthropic.claude-3-v1:0"]
  );
});
