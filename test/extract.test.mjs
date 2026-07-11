import test from "node:test";
import assert from "node:assert/strict";
import { extractArticlePublishedAt, extractEvents } from "../lib/extract.mjs";
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

test("news chrome is removed without losing abbreviated publish dates", () => {
  const source = {
    id: "fixture-news",
    vendor: "test",
    platform: "news",
    kind: "news",
    parser: "article-links",
    url: "https://example.com/news"
  };
  const html = `
    <main>
      <a href="/news/claude-tag">
        <h2>Jul 9, 2026AnnouncementsIntroducing Claude Tag</h2>
        <p>Jul 9, 2026Announcements Introducing Claude Tag for teams using Claude.</p>
      </a>
    </main>`;
  const events = extractEvents(source, html);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Introducing Claude Tag");
  assert.equal(events[0].publishedAt, "2026-07-09");
});

test("google blog analytics metadata provides publish dates", () => {
  const source = {
    id: "gemini-news",
    vendor: "google",
    platform: "gemini",
    kind: "news",
    parser: "article-links",
    url: "https://blog.google/products-and-platforms/products/gemini/"
  };
  const html = `
    <main>
      <a href="https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-computer-use-gemini-3-5-flash/"
        data-ga4-analytics-lead-click='{"article_name":"Introducing computer use in Gemini 3.5 Flash","publish_date":"2026-06-24|16:00"}'>
        <h3>Introducing computer use in Gemini 3.5 Flash</h3>
      </a>
    </main>`;
  const events = extractEvents(source, html);
  assert.equal(events.length, 1);
  assert.equal(events[0].publishedAt, "2026-06-24");
});

test("bedrock lifecycle policy dates are not treated as publish dates", () => {
  const source = {
    id: "bedrock-lifecycle",
    vendor: "aws",
    platform: "amazon-bedrock",
    kind: "deprecation",
    parser: "headings",
    url: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html"
  };
  const html = `
    <main>
      <h2>Legacy and end-of-life (EOL) models</h2>
      <p>For models with EOL dates after February 1, 2026, public extended access rules apply.</p>
      <p>Jamba 1.5 Large ai21.jamba-1-5-large-v1:0 Legacy date May 26, 2026 EOL date November 26, 2026.</p>
    </main>`;
  const events = extractEvents(source, html);
  assert.equal(events.length, 1);
  assert.equal(events[0].publishedAt, null);
});

test("article detail pages can provide visible publish dates", () => {
  const html = `
    <article>
      <h1>Inviting hard questions</h1>
      <div class="body-3 agate">Jul 9, 2026</div>
    </article>`;
  assert.equal(extractArticlePublishedAt(html), "2026-07-09");
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
