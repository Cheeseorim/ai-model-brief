import briefingConfig from "../config/briefing.json" with { type: "json" };

const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_LIMIT = 10;

export async function enrichWithOpenAISummaries(events, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey || events.length === 0) return { events, summarized: 0, skipped: true };

  const model = options.model || process.env.SUMMARY_MODEL || DEFAULT_MODEL;
  const limit = Number(options.limit || process.env.SUMMARY_MAX_EVENTS || DEFAULT_LIMIT);
  const candidates = selectSummaryCandidates(events, limit);
  let summarized = 0;

  for (const event of candidates) {
    try {
      const summary = await summarizeEvent(event, { apiKey, model });
      event.titleKo = summary.titleKo;
      event.summaryKo = summary.summaryKo;
      event.impactKo = summary.impactKo;
      event.actionKo = summary.actionKo;
      event.whoShouldCareKo = summary.whoShouldCareKo;
      event.urgency = summary.urgency;
      event.changeType = summary.changeType;
      event.confidence = summary.confidence;
      event.isProbablyNoise = summary.isProbablyNoise;
      event.clusterKey = summary.clusterKey || makeClusterKey(event);
      event.briefKo = {
        title: summary.briefTitleKo || summary.titleKo,
        change: summary.summaryKo,
        impact: summary.impactKo,
        action: summary.actionKo,
        audience: summary.whoShouldCareKo,
        urgency: summary.urgency
      };
      event.summaryMeta = {
        provider: "openai",
        model,
        summarizedAt: new Date().toISOString(),
        changeType: summary.changeType,
        confidence: summary.confidence,
        isProbablyNoise: summary.isProbablyNoise,
        clusterKey: summary.clusterKey || makeClusterKey(event)
      };
      summarized += 1;
    } catch (error) {
      event.summaryError = error.message;
      console.error(`${event.sourceId}: OpenAI summary failed: ${error.message}`);
    }
  }

  return { events, summarized, skipped: false, model };
}

export function selectSummaryCandidates(events, limit = DEFAULT_LIMIT) {
  return [...events]
    .filter((event) => !event.summaryKo && isUsefulForModelSummary(event))
    .sort((a, b) => summaryScore(b) - summaryScore(a))
    .slice(0, limit);
}

function isUsefulForModelSummary(event) {
  const text = `${event.title} ${event.summary}`.toLowerCase();
  if (/^(home|overview|resources|documentation|table of contents)$/i.test(event.title || "")) return false;
  if (/^(get started|quickstart|send feedback|navigation)$/i.test(event.title || "")) return false;
  if (/listed below|we use the term|notifies customers|regularly check|table of contents|overview quickstart/.test(text)) return false;
  return event.severity >= 55 || event.watched || /release|deprecat|pricing|retir|sunset|launch|preview|model|api/.test(text);
}

function summaryScore(event) {
  let score = event.severity || 0;
  if (event.watched) score += 20;
  if (event.kind === "deprecation") score += 18;
  if (event.kind === "breaking-change") score += 16;
  if (event.kind === "pricing") score += 14;
  if (event.kind === "release") score += 10;
  if (event.modelIds?.length) score += 8;
  if (/changelog|release-notes|deprecations|doc-history/.test(event.sourceId || "")) score += 8;
  if (/gpt[-\s]?\d|claude|gemini|bedrock|realtime|computer use|voice/i.test(`${event.title} ${event.summary}`)) score += 10;
  if (/^(get started|overview|documentation|latest models comparison)$/i.test(event.title || "")) score -= 50;
  return score;
}

async function summarizeEvent(event, { apiKey, model }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "developer",
          content: [
            "너는 AI 모델/API 변경사항을 매일 아침 요약하는 한국어 운영 브리핑 에디터다.",
            "기계 번역체를 피하고, 전문적이되 자연스러운 한국어로 쓴다.",
            "주어진 공식 출처 내용만 근거로 삼고, 모르는 내용은 추측하지 않는다.",
            "사용자가 해야 할 확인 작업을 구체적으로 적는다.",
            "목차, 개요, 문서 내비게이션, 단순 모델 목록처럼 운영 판단 가치가 낮은 항목은 isProbablyNoise=true 또는 urgency=low로 낮춘다.",
            "같은 이슈가 여러 출처에서 반복될 수 있으므로 clusterKey는 같은 이슈끼리 묶일 정도로 안정적인 짧은 키로 만든다.",
            "반드시 JSON만 출력한다."
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "다음 모델/API 업데이트를 한국어 브리핑으로 요약해줘.",
            outputSchema: {
              titleKo: "카드 제목. 60자 이내.",
              briefTitleKo: "헤드라인 제목. 60자 이내.",
              summaryKo: "무엇이 바뀌었는지. 1~2문장.",
              impactKo: "사용자/운영자에게 왜 중요한지. 1문장.",
              actionKo: "오늘 확인할 일. 1문장.",
              whoShouldCareKo: "누가 봐야 하는지. 예: Bedrock에서 Claude를 쓰는 팀.",
              urgency: "high | medium | low",
              changeType: "new_model | deprecation | pricing | api_change | docs_only | product_news | availability",
              confidence: "high | medium | low",
              isProbablyNoise: "운영 브리핑 가치가 낮으면 true",
              clusterKey: "vendor와 이슈를 묶는 짧은 키. 예: openai:gpt-5.6-family"
            },
            briefingContext: briefingConfig,
            styleExamples: [
              {
                weak: "지원 종료 항목이 감지되었습니다.",
                better: "Claude API에서 특정 모델의 종료 일정이 갱신됐습니다. 사용 중인 모델 ID와 대체 모델을 대조해야 합니다."
              },
              {
                weak: "공식 문서에 업데이트가 올라왔습니다.",
                better: "GPT-5.6 계열이 모델 문서에 추가됐습니다. 비용·추론 기능·alias 적용 범위를 평가 후보에 넣어야 합니다."
              }
            ],
            event: {
              vendor: event.vendor,
              platform: event.platform,
              kind: event.kind,
              sourceId: event.sourceId,
              title: event.title,
              summary: event.summary,
              modelIds: event.modelIds,
              publishedAt: event.publishedAt,
              sourceUrl: event.sourceUrl
            }
          })
        }
      ],
      max_output_tokens: 700
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI API HTTP ${response.status}`);
  }

  const text = extractOutputText(payload);
  const parsed = parseJsonObject(text);
  return validateSummary(parsed);
}

function extractOutputText(payload) {
  if (payload.output_text) return payload.output_text;
  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function parseJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("OpenAI response did not contain JSON");
    return JSON.parse(match[0]);
  }
}

function validateSummary(value) {
  const required = ["titleKo", "summaryKo", "impactKo", "actionKo"];
  for (const key of required) {
    if (!value[key] || typeof value[key] !== "string") {
      throw new Error(`OpenAI summary missing ${key}`);
    }
  }
  return {
    titleKo: value.titleKo.slice(0, 120),
    briefTitleKo: (value.briefTitleKo || value.titleKo).slice(0, 120),
    summaryKo: value.summaryKo.slice(0, 600),
    impactKo: value.impactKo.slice(0, 400),
    actionKo: value.actionKo.slice(0, 400),
    whoShouldCareKo: stringOrDefault(value.whoShouldCareKo, "현재 해당 공급사의 모델/API를 쓰는 팀").slice(0, 300),
    urgency: enumOrDefault(value.urgency, ["high", "medium", "low"], "medium"),
    changeType: enumOrDefault(value.changeType, ["new_model", "deprecation", "pricing", "api_change", "docs_only", "product_news", "availability"], "docs_only"),
    confidence: enumOrDefault(value.confidence, ["high", "medium", "low"], "medium"),
    isProbablyNoise: Boolean(value.isProbablyNoise),
    clusterKey: stringOrDefault(value.clusterKey, "").slice(0, 120)
  };
}

function stringOrDefault(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function enumOrDefault(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function makeClusterKey(event) {
  const vendor = event.vendor || "unknown";
  const title = String(event.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${vendor}:${title || event.sourceId || "update"}`;
}
