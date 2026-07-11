import briefingConfig from "../config/briefing.json" with { type: "json" };
import terminologyConfig from "../config/terminology.json" with { type: "json" };

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
      const summary = postprocessSummary(await summarizeEvent(event, { apiKey, model }), event);
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
      event.routes = summary.routes?.length ? summary.routes : routeEvent(event, summary);
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
        clusterKey: summary.clusterKey || makeClusterKey(event),
        routes: event.routes,
        promptTipLane: summary.promptTipLane,
        promptTipKo: summary.promptTipKo,
        promptTipEvidenceKo: summary.promptTipEvidenceKo,
        promptTipExampleKo: summary.promptTipExampleKo
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
            "용어 사전을 따른다. 예: deprecation은 지원 종료, retire는 종료, availability는 제공 여부, region은 리전으로 쓴다.",
            "금지 표현을 피한다. 특히 ‘감지되었습니다’, ‘업데이트가 올라왔습니다’, ‘관련 공지’, ‘관련 업데이트’를 쓰지 않는다.",
            "변경 유형별 문장 규칙을 따른다. 지원 종료는 대상과 날짜, 가격은 단가와 재계산 대상, API 변경은 호환성 영향과 테스트 지점을 앞에 둔다.",
            "목차, 개요, 문서 내비게이션, 단순 모델 목록처럼 운영 판단 가치가 낮은 항목은 isProbablyNoise=true 또는 urgency=low로 낮춘다.",
            "같은 이슈가 여러 출처에서 반복될 수 있으므로 clusterKey는 같은 이슈끼리 묶일 정도로 안정적인 짧은 키로 만든다.",
            "콘텐츠 라우터를 함께 판단한다. 모델/API/가격/지원 종료처럼 운영자가 바로 확인해야 할 내용은 routes에 news를 넣는다.",
            "프롬프트 작성, 컨텍스트 구성, 메모리, 도구 호출, 평가셋, 벤치마크, 자동화 검증에 적용할 수 있는 내용은 routes에 prompt_tip을 넣는다.",
            "팁 성격이 있다면 promptTipLane은 prompt, context, harness 중 하나로 고른다.",
            "prompt_tip은 체크리스트 문체가 아니라 짧은 테크블로그/칼럼 문체로 쓴다. 독자가 '아, 내 프롬프트에 이렇게 적용하면 되겠구나'라고 느끼게 설명한다.",
            "prompt_tip은 원문 근거를 반드시 언급한다. 원문 제목/요약의 어떤 표현, 기능명, API명, 평가명 때문에 이 팁을 뽑았는지 자연스러운 문장으로 쓴다.",
            "prompt_tip의 예시는 추상적인 '비교하세요'가 아니라 실제 요청문, 컨텍스트 블록, 테스트 케이스, 도구 호출 검증 중 하나가 떠오르게 구체적으로 쓴다.",
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
              clusterKey: "vendor와 이슈를 묶는 짧은 키. 예: openai:gpt-5.6-family",
              routes: "배열. news, prompt_tip 중 해당하는 값을 1개 이상.",
              promptTipLane: "routes에 prompt_tip이 있으면 prompt | context | harness 중 하나. 없으면 null.",
              promptTipKo: "팁용 본문. 프롬프트/컨텍스트/하니스 개선에 어떻게 쓸지 테크블로그 문단처럼 쉽게 풀어쓴다. 없으면 빈 문자열.",
              promptTipEvidenceKo: "팁의 원문 근거. 원문 제목/요약의 표현, 기능명, API명, 평가명 중 어떤 단서 때문에 이 팁이 나왔는지 자연스럽게 설명한다. 없으면 빈 문자열.",
              promptTipExampleKo: "실무 적용 예시. 실제 요청문, 컨텍스트 블록, 테스트 케이스, 도구 호출 검증 중 하나가 떠오르게 구체적으로 쓴다. 없으면 빈 문자열."
            },
            briefingContext: briefingConfig,
            terminology: terminologyConfig,
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

function postprocessSummary(summary, event) {
  const result = { ...summary };
  for (const key of ["titleKo", "briefTitleKo", "summaryKo", "impactKo", "actionKo", "whoShouldCareKo"]) {
    result[key] = polishKorean(result[key] || "", event, key);
  }
  if (!result.briefTitleKo) result.briefTitleKo = result.titleKo;
  return result;
}

function polishKorean(value, event, key) {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return text;
  const vendor = terminologyConfig.providerDisplayNames?.[event.vendor] || event.vendor || "해당 공급사";
  const source = event.sourceId || "";
  const model = event.modelIds?.[0] || "모델";
  const replacements = [
    [/지원 종료 항목이 감지되었습니다\.?/g, `${vendor}의 모델 종료 일정이 바뀌었습니다.`],
    [/업데이트가 올라왔습니다\.?/g, "변경사항이 확인됐습니다."],
    [/공식 문서에 새 업데이트가 있습니다\.?/g, "공식 문서의 변경 내용을 확인했습니다."],
    [/공식 문서에 새 업데이트가 올라왔습니다\.?/g, "공식 문서의 변경 내용을 확인했습니다."],
    [/관련 공지/g, "안내"],
    [/관련 업데이트/g, "변경사항"],
    [/확인할 필요가 있습니다/g, "확인해야 합니다"],
    [/최신 모델 비교/g, "모델 비교 문서"],
    [/\bAWS\b/g, "Amazon Bedrock"],
    [/Google의 Vertex/g, "Vertex AI"],
    [/Anthropic가/g, "Anthropic이"],
    [/OpenAI이/g, "OpenAI가"],
    [/Google가/g, "Google이"],
    [/Amazon Bedrock가/g, "Amazon Bedrock이"]
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);

  if (/변경사항이 확인됐습니다\.?$/.test(text) && key === "summaryKo") {
    if (event.kind === "deprecation") return `${vendor}에서 ${model} 수명주기나 종료 일정이 바뀌었습니다. 사용 중인 모델 ID와 대체 모델을 대조해야 합니다.`;
    if (event.kind === "pricing") return `${vendor} 가격·과금 문서가 바뀌었습니다. 호출량이 큰 워크로드부터 비용을 다시 계산해야 합니다.`;
    if (event.kind === "release") return `${vendor}에 새 모델이나 기능이 추가됐습니다. 기존 후보와 성능·가격·제공 여부를 비교해야 합니다.`;
    if (/vertex/i.test(source)) return "Vertex AI 문서의 생성형 AI 안내가 바뀌었습니다. Gemini API와 Vertex AI 중 어느 경로에 영향이 있는지 구분해서 확인해야 합니다.";
  }
  return text;
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
    clusterKey: stringOrDefault(value.clusterKey, "").slice(0, 120),
    routes: normalizeRoutes(value.routes),
    promptTipLane: enumOrDefault(value.promptTipLane, ["prompt", "context", "harness", null], null),
    promptTipKo: stringOrDefault(value.promptTipKo, "").slice(0, 700),
    promptTipEvidenceKo: stringOrDefault(value.promptTipEvidenceKo, "").slice(0, 500),
    promptTipExampleKo: stringOrDefault(value.promptTipExampleKo, "").slice(0, 500)
  };
}

function normalizeRoutes(value) {
  const routes = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const normalized = routes
    .map((route) => String(route || "").trim())
    .filter((route) => ["news", "prompt_tip"].includes(route));
  return [...new Set(normalized)];
}

function routeEvent(event, summary = {}) {
  const routes = new Set();
  const text = `${event.title || ""} ${event.summary || ""} ${summary.titleKo || ""} ${summary.summaryKo || ""}`.toLowerCase();
  if (!summary.isProbablyNoise && (
    event.severity >= 55 ||
    ["deprecation", "breaking-change", "pricing", "release"].includes(event.kind) ||
    /model|api|pricing|billing|release|launch|preview|deprecat|retir|sunset|availability|rate limit/.test(text)
  )) {
    routes.add("news");
  }
  if (/prompt|context|memory|mcp|tool|agent|eval|benchmark|harness|reasoning|cache|caching|computer use|workflow|reflect/.test(text)) {
    routes.add("prompt_tip");
  }
  if (!routes.size) routes.add("news");
  return [...routes];
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
