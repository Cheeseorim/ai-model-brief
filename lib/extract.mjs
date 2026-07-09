import * as cheerio from "cheerio";
import {
  canonicalUrl,
  classify,
  cleanText,
  extractModelIds,
  hash,
  severityFor
} from "./text.mjs";

const DATE_HEADING =
  /^(?:[A-Z][a-z]+ \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2}|[A-Z][a-z]+,? \d{4})$/;

function prepare(html) {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,nav,footer,form,button").remove();
  return $;
}

function eventFrom(source, title, body, url, ordinal = 0) {
  const text = cleanText(`${title}\n${body}`).slice(0, 12000);
  const modelIds = extractModelIds(text);
  const kind = classify(text, source.kind);
  return {
    id: hash(`${source.id}|${title}|${url}|${ordinal}`),
    fingerprint: hash(`${source.id}|${cleanText(text).toLowerCase()}`),
    sourceId: source.id,
    vendor: source.vendor,
    platform: source.platform,
    kind,
    title: cleanText(title).slice(0, 240),
    summary: cleanText(body).slice(0, 1000),
    modelIds,
    sourceUrl: canonicalUrl(url, source.url),
    severity: severityFor(kind, text),
    publishedAt: parseDate(text),
    detectedAt: new Date().toISOString()
  };
}

function parseDate(text) {
  const match = text.match(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December),? \d{4}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2},? \d{4}\b|\b\d{4}-\d{2}-\d{2}\b/
  );
  if (!match) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(match[0])) return match[0];
  const parts = match[0].replace(",", "").split(" ");
  if (parts.length === 2) {
    const month = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December"
    ].indexOf(parts[0]);
    const parsed = new Date(Date.UTC(Number(parts[1]), month, 1));
    return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
  }
  const month = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ].indexOf(parts[0]);
  const parsed = new Date(Date.UTC(Number(parts[2]), month, Number(parts[1])));
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

function parseLooseDate(value) {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
  return parseDate(value);
}

function datedSections($, source) {
  const events = [];
  $("h2,h3").each((index, element) => {
    const title = cleanText($(element).text());
    if (!DATE_HEADING.test(title)) return;
    const chunks = [];
    let cursor = $(element).next();
    while (cursor.length && !["h2", "h3"].includes(cursor[0].tagName)) {
      chunks.push(cursor.text());
      cursor = cursor.next();
    }
    const body = cleanText(chunks.join("\n"));
    if (body.length >= 20) events.push(eventFrom(source, title, body, source.url, index));
  });
  return events;
}

function headingSections($, source) {
  const events = [];
  $("main h2, main h3, article h2, article h3, body h2, body h3").each(
    (index, element) => {
      const title = cleanText($(element).text());
      if (!title || title.length > 240) return;
      const chunks = [];
      let cursor = $(element).next();
      while (cursor.length && !/^h[1-3]$/.test(cursor[0].tagName)) {
        chunks.push(cursor.text());
        cursor = cursor.next();
      }
      const body = cleanText(chunks.join("\n"));
      if (body.length >= 30) events.push(eventFrom(source, title, body, source.url, index));
    }
  );
  return events;
}

function articleLinks($, source) {
  const seen = new Set();
  const events = [];
  $("main a[href], article a[href], body a[href]").each((index, element) => {
    const href = canonicalUrl($(element).attr("href"), source.url);
    const title = cleanText($(element).find("h2,h3,h4").first().text() || $(element).text());
    if (
      seen.has(href) ||
      title.length < 12 ||
      title.length > 240 ||
      /^(skip to|main content|sign in|subscribe|privacy|terms)/i.test(title) ||
      new URL(href).hostname !== new URL(source.url).hostname
    ) return;
    const context = cleanText($(element).parent().text());
    if (!parseDate(context) && !/\/news\/|\/blog\//.test(href) && new URL(href).hostname !== "blog.google") return;
    seen.add(href);
    events.push(eventFrom(source, title, context, href, index));
  });
  return events.slice(0, 60);
}

function tableRows($, source) {
  const events = [];
  $("tr").each((index, element) => {
    const cells = $(element).find("th,td");
    if (cells.length < 2) return;
    const title = cleanText($(cells[0]).text());
    const body = cleanText($(cells[1]).text());
    const date = cleanText($(cells[2]).text());
    const href = $(cells[0]).find("a[href]").first().attr("href") || source.url;
    if (!title || title.length > 240 || body.length < 12) return;
    const event = eventFrom(source, title, `${body}\n${date}`, href, index);
    event.publishedAt = parseLooseDate(date) || event.publishedAt;
    events.push(event);
  });
  return events;
}

function rss($, source) {
  const events = [];
  $("item, entry").each((index, element) => {
    const item = $(element);
    const title = cleanText(item.find("title").first().text());
    const body = cleanText(
      item.find("description, summary, content, content\\:encoded").first().text()
    );
    const link = cleanText(item.find("link").first().text()) || item.find("link").first().attr("href") || source.url;
    const date = cleanText(item.find("pubDate, published, updated").first().text());
    if (!title || title.length > 240) return;
    const event = eventFrom(source, title, `${body}\n${date}`, link, index);
    event.publishedAt = parseLooseDate(date) || event.publishedAt;
    events.push(event);
  });
  return events;
}

export function extractEvents(source, html) {
  const $ = source.parser === "rss" ? cheerio.load(html, { xmlMode: true }) : prepare(html);
  const extractors = {
    "dated-sections": datedSections,
    headings: headingSections,
    "article-links": articleLinks,
    "table-rows": tableRows,
    rss
  };
  const events = extractors[source.parser]($, source);
  return dedupe(events);
}

function dedupe(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = `${event.title.toLowerCase()}|${event.sourceUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
