import { createHash } from "node:crypto";

export function cleanText(value = "") {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function canonicalUrl(value, base) {
  const url = new URL(value, base);
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || ["hl", "authuser", "ref"].includes(key)) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  return url.toString();
}

export function extractModelIds(text) {
  const normalized = text.replace(
    /([a-z0-9])(?=(?:anthropic|amazon|meta|cohere|mistral|ai21)\.)/gi,
    "$1 "
  ).replace(/(:\d)(?=[A-Z])/g, "$1 ");
  const patterns = [
    /\b(?:gpt|o[1-9]|text-embedding|omni-moderation|dall-e)-[a-z0-9]+(?:[._-][a-z0-9]+){0,9}\b/gi,
    /\bclaude-[a-z0-9]+(?:[._-][a-z0-9]+){0,9}\b/gi,
    /\b(?:gemini|imagen|veo|text-embedding)-[a-z0-9]+(?:[._-][a-z0-9]+){0,9}\b/gi,
    /\b(?:anthropic|amazon|meta|cohere|mistral|ai21)\.[a-z0-9]+(?:[._:-][a-z0-9]+){0,12}\b/gi
  ];
  const matches = [...new Set(patterns.flatMap((pattern) => normalized.match(pattern) || []))]
    .filter((match) => match.length <= 96);
  return matches.filter((match) => !matches.some((other) => other !== match && other.includes(match)));
}

export function classify(text, fallback) {
  const lower = text.toLowerCase();
  if (/(deprecat|retir|shut.?down|end.of.life|legacy|sunset)/.test(lower)) return "deprecation";
  if (/(breaking change|migration|required action)/.test(lower)) return "breaking-change";
  if (/(pricing|price|cost per|token price)/.test(lower)) return "pricing";
  if (/(launch|released|introduc|generally available|public preview)/.test(lower)) return "release";
  return fallback;
}

export function severityFor(kind, text, watched = false) {
  let score = {
    deprecation: 90,
    "breaking-change": 80,
    pricing: 70,
    release: 55,
    changelog: 45,
    models: 35,
    news: 20
  }[kind] ?? 30;
  if (watched) score += 10;
  if (/\b(?:7|14|30) days?\b|immediately|effective today/i.test(text)) score += 8;
  return Math.min(score, 100);
}
