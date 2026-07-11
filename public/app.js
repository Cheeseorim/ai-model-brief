const [events, state, pricing] = await Promise.all([
  fetch("./data/events.json?v=20260711-date-labels").then((response) => response.json()),
  fetch("./data/state.json?v=20260711-date-labels").then((response) => response.json()),
  fetch("./config/pricing.json?v=20260710-pricing2").then((response) => response.json()).catch(() => ({ models: [], sources: [] }))
]);

const ui = {
  health: document.querySelector("#health"),
  tabNav: document.querySelector(".section-tabs"),
  tabs: [...document.querySelectorAll(".section-tabs button")],
  panels: [...document.querySelectorAll(".tab-panel")],
  coverage: document.querySelector("#coverage"),
  coverageMeta: document.querySelector("#coverageMeta"),
  headlines: document.querySelector("#headlines"),
  headlineMeta: document.querySelector("#headlineMeta"),
  pricingRows: document.querySelector("#pricingRows"),
  pricingMeta: document.querySelector("#pricingMeta"),
  pricingSources: document.querySelector("#pricingSources"),
  pricingModelToggles: document.querySelector("#pricingModelToggles"),
  pricingEstimate: document.querySelector("#pricingEstimate"),
  inputTokens: document.querySelector("#inputTokens"),
  outputTokens: document.querySelector("#outputTokens"),
  dailyRequests: document.querySelector("#dailyRequests")
};

let selectedPricingModelId = "";
let selectedCoverageVendor = "";
const HEADLINE_LIMIT = 5;
const labels = {
  deprecation: "지원 종료",
  "breaking-change": "호환성 변경",
  release: "신규 출시",
  pricing: "가격",
  changelog: "변경 로그",
  models: "모델",
  news: "뉴스"
};
const vendorLabels = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini / Vertex AI",
  aws: "Amazon Bedrock"
};
const sourceLabels = {
  "openai-changelog": "API 변경 로그",
  "openai-deprecations": "지원 종료",
  "openai-models": "모델 문서",
  "openai-news": "뉴스 RSS",
  "anthropic-release-notes": "Claude 릴리스 노트",
  "anthropic-deprecations": "모델 지원 종료",
  "anthropic-models": "모델 문서",
  "anthropic-news": "뉴스",
  "gemini-changelog": "Gemini API 변경 로그",
  "gemini-deprecations": "지원 종료",
  "gemini-models": "모델 문서",
  "gemini-news": "Gemini 블로그",
  "vertex-release-notes": "Vertex AI 릴리스 노트",
  "vertex-deprecations": "Vertex AI 지원 종료",
  "bedrock-lifecycle": "모델 수명주기",
  "bedrock-doc-history": "문서 변경 이력"
};

for (const input of [ui.inputTokens, ui.outputTokens, ui.dailyRequests]) {
  input?.addEventListener("input", renderPricing);
}
ui.tabNav?.addEventListener("click", (event) => {
  const tab = event.target.closest("button[data-tab]");
  if (!tab) return;
  activateTab(tab.dataset.tab || "briefing");
});

const sourceStates = Object.values(state.sources || {});
const failures = sourceStates.filter((source) => !source.ok);
ui.health.textContent = failures.length
  ? `수집기 ${failures.length}개 확인 필요`
  : `마지막 수집 ${formatDateTime(state.lastRunAt)}`;
ui.health.classList.add(failures.length ? "bad" : "ok");

renderCoverage();
renderHeadlines();
renderPricing();
activateTab(initialTab());

function initialTab() {
  const hash = window.location.hash.replace("#", "");
  return ["briefing", "vendors", "pricing"].includes(hash) ? hash : "briefing";
}

function activateTab(tabName) {
  const safeTab = ["briefing", "vendors", "pricing"].includes(tabName) ? tabName : "briefing";
  for (const tab of ui.tabs) {
    const active = tab.dataset.tab === safeTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  for (const panel of ui.panels) {
    panel.classList.toggle("active", panel.dataset.panel === safeTab);
  }
  if (window.location.hash.replace("#", "") !== safeTab) {
    history.replaceState(null, "", `#${safeTab}`);
  }
}

function renderCoverage() {
  const byVendor = coverageByVendor();
  const items = [...byVendor.values()].sort((a, b) => vendorSort(a.vendor) - vendorSort(b.vendor));
  if (!selectedCoverageVendor && items.length) selectedCoverageVendor = items[0].vendor;
  ui.coverageMeta.textContent = "펼쳐서 세부 이슈를 바로 확인";
  ui.coverage.replaceChildren(...items.map(coverageCard));
}

function coverageByVendor() {
  const byVendor = new Map();
  const anchor = new Date();
  const windowStart = new Date(anchor);
  windowStart.setDate(windowStart.getDate() - 7);
  for (const event of events) {
    const item = byVendor.get(event.vendor) || {
      vendor: event.vendor,
      sources: new Set(),
      recent: [],
      fallback: []
    };
    item.sources.add(event.sourceId);
    if (isBriefingCandidate(event)) {
      const date = eventDateForBriefing(event);
      if (date && date >= windowStart && date <= anchor) item.recent.push(event);
      else item.fallback.push(event);
    }
    byVendor.set(event.vendor, item);
  }
  return byVendor;
}

function coverageCard(item) {
  const pool = vendorIssuePool(item);
  const primary = pool[0];
  const brief = primary ? briefing(primary) : null;
  const isActive = selectedCoverageVendor === item.vendor;
  const detailPool = uniqueVendorIssues(pool).slice(0, 6);
  const status = item.recent.length
    ? `최근 7일 ${item.recent.length.toLocaleString("ko-KR")}건`
    : "최근 고위험 이슈 중심";
  const article = document.createElement("article");
  article.className = `coverage-card vendor-${item.vendor} ${isActive ? "active" : ""}`;
  article.dataset.vendor = item.vendor;
  article.innerHTML = `
    <button type="button" class="coverage-toggle" aria-expanded="${String(isActive)}">
      <div class="coverage-main">
        <div class="coverage-top">
          <strong>${vendorLabels[item.vendor] || item.vendor}</strong>
          <span>${status}</span>
        </div>
        <h3>${escapeHtml(brief?.title || "특이 업데이트 없음")}</h3>
        <p class="coverage-summary">${escapeHtml(brief ? brief.change : "새로 확인할 만한 주요 변경은 아직 없습니다.")}</p>
      </div>
      <span class="coverage-cta">${isActive ? "접기" : "세부 이슈 보기"}</span>
    </button>
    ${isActive ? coverageInlineDetail(item, detailPool) : ""}
  `;
  article.querySelector(".coverage-toggle").addEventListener("click", () => {
    selectedCoverageVendor = selectedCoverageVendor === item.vendor ? "" : item.vendor;
    renderCoverage();
  });
  return article;
}

function coverageInlineDetail(item, pool) {
  const sourceList = [...item.sources].map((id) => sourceLabels[id] || id).join(", ");
  return `
    <div class="coverage-detail">
      <div class="coverage-detail-head">
        <div>
          <p class="eyebrow">${escapeHtml(vendorLabels[item.vendor] || item.vendor)}</p>
          <h3>${escapeHtml(vendorLabels[item.vendor] || item.vendor)}에서 더 볼 이슈</h3>
        </div>
        <span>${escapeHtml(sourceList)}</span>
      </div>
      <div class="issue-list">
        ${pool.length ? pool.map(detailIssue).join("") : `<p class="empty-detail">지금 더 확인할 만한 세부 이슈는 없습니다.</p>`}
      </div>
    </div>
  `;
}

function detailIssue(event) {
  const brief = briefing(event);
  const models = Array.isArray(event.modelIds) ? event.modelIds.slice(0, 4) : [];
  return `
    <article class="issue-item vendor-${escapeHtml(event.vendor || "")} ${escapeHtml(event.kind || "")}">
      <div class="issue-meta">
        <span>${escapeHtml(labels[event.kind] || event.kind || "업데이트")}</span>
        <span>${escapeHtml(sourceLabels[event.sourceId] || event.sourceId || "")}</span>
        <span>${escapeHtml(dateBadge(event))}</span>
      </div>
      <h4>${escapeHtml(brief.title)}</h4>
      <p>${escapeHtml(brief.change)}</p>
      <div class="issue-bottom">
        ${models.length ? `<span>${escapeHtml(models.join(", "))}</span>` : "<span>모델 ID 없음</span>"}
        <a href="${escapeHtml(event.sourceUrl || "#")}" target="_blank" rel="noreferrer">원문 보기 ↗</a>
      </div>
    </article>
  `;
}

function vendorIssuePool(item) {
  return (item.recent.length ? item.recent : item.fallback)
    .sort((a, b) => briefingScore(b) - briefingScore(a));
}

function uniqueVendorIssues(items) {
  const seen = new Set();
  const result = [];
  for (const event of items) {
    const key = event.clusterKey || event.summaryMeta?.clusterKey || `${event.vendor}|${normalizeTitle(briefing(event).title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }
  return result;
}

function renderPricing() {
  if (!ui.pricingRows) return;
  const models = pricedModels();
  const inputTokens = Math.max(0, Number(ui.inputTokens?.value || 0));
  const outputTokens = Math.max(0, Number(ui.outputTokens?.value || 0));
  const dailyRequests = Math.max(0, Number(ui.dailyRequests?.value || 0));
  const sorted = [...models].sort((a, b) => vendorSort(a.vendor) - vendorSort(b.vendor)
    || (a.input ?? 999) - (b.input ?? 999)
    || (a.output ?? 999) - (b.output ?? 999)
    || a.model.localeCompare(b.model));
  if (!selectedPricingModelId && sorted.length) selectedPricingModelId = pricingModelId(sorted[0]);
  ui.pricingMeta.textContent = pricing.verifiedAt
    ? `공식 가격 기준 · ${pricing.verifiedAt}`
    : "공식 가격 기준";
  ui.pricingRows.replaceChildren(...sorted.map((model) => pricingRow(model)));
  renderPricingModelToggles(sorted);
  renderPricingEstimate(sorted, inputTokens, outputTokens, dailyRequests);
  ui.pricingSources.innerHTML = (pricing.sources || [])
    .map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)}</a>`)
    .join("<span>·</span>");
}

function pricingRow(model) {
  const tr = document.createElement("tr");
  tr.className = `vendor-${model.vendor}`;
  const source = (pricing.sources || []).find((item) => item.vendor === model.vendor);
  tr.innerHTML = `
    <td>
      <strong>${escapeHtml(model.model)}</strong>
      <span>${escapeHtml(vendorLabels[model.vendor] || model.vendor)} · ${escapeHtml(model.platform || "")}${model.region ? ` · ${escapeHtml(model.region)}` : ""}</span>
    </td>
    <td>${priceCell(model.input)}</td>
    <td>${priceCell(model.output)}</td>
    <td>${priceCell(model.cacheRead)}</td>
    <td>
      ${escapeHtml(model.notes || model.tier || "")}
      ${source ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">출처 ↗</a>` : ""}
    </td>
  `;
  return tr;
}

function renderPricingModelToggles(models) {
  if (!ui.pricingModelToggles) return;
  ui.pricingModelToggles.replaceChildren(...models.map((model) => {
    const id = pricingModelId(model);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `vendor-${model.vendor} ${id === selectedPricingModelId ? "active" : ""}`;
    button.textContent = model.model;
    button.addEventListener("click", () => {
      selectedPricingModelId = id;
      renderPricing();
    });
    return button;
  }));
}

function renderPricingEstimate(models, inputTokens, outputTokens, dailyRequests) {
  if (!ui.pricingEstimate) return;
  const selected = models.find((model) => pricingModelId(model) === selectedPricingModelId) || models[0];
  if (!selected) {
    ui.pricingEstimate.innerHTML = "<p>계산할 모델 가격 데이터가 없습니다.</p>";
    return;
  }
  const monthly = estimateMonthlyCost(selected, inputTokens, outputTokens, dailyRequests);
  const daily = monthly == null ? null : monthly / 30;
  const inputCost = typeof selected.input === "number" ? inputTokens * dailyRequests * 30 / 1_000_000 * selected.input : null;
  const outputCost = typeof selected.output === "number" ? outputTokens * dailyRequests * 30 / 1_000_000 * selected.output : null;
  ui.pricingEstimate.innerHTML = `
    <div class="vendor-${escapeHtml(selected.vendor || "")}">
      <span>선택 모델</span>
      <strong>${escapeHtml(selected.model)}</strong>
      <small>${escapeHtml(vendorLabels[selected.vendor] || selected.vendor)} · ${escapeHtml(selected.platform || "")}</small>
    </div>
    <div>
      <span>월 예상 비용</span>
      <strong>${monthly == null ? "확인 필요" : formatCurrency(monthly)}</strong>
      <small>30일 기준 · 일 ${daily == null ? "—" : formatCurrency(daily)}</small>
    </div>
    <div>
      <span>비용 구성</span>
      <strong>${inputCost == null || outputCost == null ? "—" : `${formatCurrency(inputCost)} + ${formatCurrency(outputCost)}`}</strong>
      <small>입력 비용 + 출력 비용</small>
    </div>
  `;
}

function estimateMonthlyCost(model, inputTokens, outputTokens, dailyRequests) {
  if (typeof model.input !== "number" || typeof model.output !== "number") return null;
  const inputMillion = inputTokens * dailyRequests * 30 / 1_000_000;
  const outputMillion = outputTokens * dailyRequests * 30 / 1_000_000;
  return inputMillion * model.input + outputMillion * model.output;
}

function priceCell(value) {
  return typeof value === "number" ? `${formatCurrency(value)} / 1M` : "—";
}

function pricedModels() {
  return (Array.isArray(pricing.models) ? pricing.models : [])
    .filter((model) => typeof model.input === "number" && typeof model.output === "number");
}

function pricingModelId(model) {
  return `${model.vendor}:${model.platform}:${model.model}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: pricing.currency || "USD", maximumFractionDigits: value < 1 ? 4 : 2 }).format(value);
}

function vendorSort(vendor) {
  return { openai: 0, anthropic: 1, google: 2, aws: 3 }[vendor] ?? 99;
}

function renderHeadlines() {
  const anchor = new Date();
  const windowStart = new Date(anchor);
  windowStart.setDate(windowStart.getDate() - 7);
  const recent = events.filter((event) => {
    const date = eventDateForBriefing(event);
    return date && date >= windowStart && date <= anchor;
  });
  const recentPool = recent.filter(isBriefingCandidate).sort((a, b) => briefingScore(b) - briefingScore(a));
  const recentKeys = new Set(recentPool.map(eventKey));
  const fallbackPool = events
    .filter((event) => isBriefingCandidate(event) && !recentKeys.has(eventKey(event)))
    .sort((a, b) => briefingScore(b) - briefingScore(a));
  const pool = [...recentPool, ...fallbackPool];
  const vendorCounts = new Map();
  const kindCounts = new Map();
  const headlines = [];
  for (const event of pool) {
    const candidateBrief = briefing(event);
    const key = event.clusterKey || event.summaryMeta?.clusterKey || `${event.vendor}|${normalizeTitle(candidateBrief.title)}`;
    if (headlines.some((item) => (item.clusterKey || item.summaryMeta?.clusterKey || `${item.vendor}|${normalizeTitle(briefing(item).title)}`) === key)) continue;
    const vendorCount = vendorCounts.get(event.vendor) || 0;
    if (vendorCount >= 2 && headlines.length < 4) continue;
    const kindCount = kindCounts.get(event.kind) || 0;
    if (event.kind === "deprecation" && kindCount >= 3) continue;
    headlines.push(event);
    vendorCounts.set(event.vendor, vendorCount + 1);
    kindCounts.set(event.kind, kindCount + 1);
    if (headlines.length === HEADLINE_LIMIT) break;
  }

  ui.headlineMeta.textContent = recent.length
    ? `최근 7일 기준 · ${headlines.length}건`
    : `최근 7일 업데이트 없음 · 최신 고위험 ${headlines.length}건`;
  ui.headlines.replaceChildren(...headlines.map(headlineCard));
}

function eventKey(event) {
  return `${event.sourceId}|${event.title}|${event.publishedAt || event.detectedAt}`;
}

function headlineCard(event, index) {
  const article = document.createElement("article");
  article.className = "headline-card";
  article.classList.add(event.kind);
  article.classList.add(`vendor-${event.vendor}`);
  const models = Array.isArray(event.modelIds) ? event.modelIds.slice(0, 3) : [];
  const brief = briefing(event);
  article.innerHTML = `
    <div class="headline-rank">${String(index + 1)}</div>
    <div class="headline-body">
      <div class="headline-meta">
        <span>${escapeHtml(vendorLabels[event.vendor] || event.vendor)}</span>
        <span>${escapeHtml(labels[event.kind] || event.kind || "")}</span>
        <span>${escapeHtml(dateBadge(event))}</span>
      </div>
      <h3>${escapeHtml(brief.title)}</h3>
      <div class="brief-points">
        <p><strong>변경</strong><span>${escapeHtml(brief.change)}</span></p>
        <p><strong>영향</strong><span>${escapeHtml(brief.impact)}</span></p>
        <p><strong>확인</strong><span>${escapeHtml(brief.action)}</span></p>
      </div>
      <div class="headline-bottom">
        <span>${escapeHtml(sourceLabels[event.sourceId] || event.sourceId || "")}</span>
        ${models.length ? `<span>${escapeHtml(models.join(", "))}</span>` : ""}
      </div>
    </div>
  `;
  article.addEventListener("click", () => {
    window.open(event.sourceUrl, "_blank", "noopener,noreferrer");
  });
  return article;
}

function briefing(event) {
  const earlyBrief = earlyRuleBriefing(event);
  if (earlyBrief) return earlyBrief;

  if (event.briefKo) {
    return {
      title: cleanDisplayTitle(event.briefKo.title || event.titleKo || koreanizeTitle(event), event),
      change: naturalizeBriefText(event.briefKo.change || event.summaryKo || usefulExcerpt(event) || "공식 문서의 변경 내용을 확인했습니다.", event),
      impact: naturalizeBriefText(event.briefKo.impact || event.impactKo || "현재 사용 중인 모델 또는 플랫폼과 직접 관련되는지 확인해야 합니다.", event),
      action: naturalizeBriefText(event.briefKo.action || event.actionKo || "원문에서 모델 ID, 적용일, 마이그레이션 안내를 확인하세요.", event)
    };
  }

  const title = event.title || "";
  const lower = `${event.title} ${event.summary}`.toLowerCase();
  const models = event.modelIds?.length ? event.modelIds.slice(0, 4).join(", ") : "";
  const readableTitle = event.titleKo || koreanizeTitle(event);
  const excerpt = usefulExcerpt(event);

  if (/self-serve fine-tuning|fine-tuned models|fine tuning/.test(lower)) {
    return {
      title: "OpenAI self-serve fine-tuning 가용성 변경",
      change: "OpenAI가 self-serve fine-tuning 플랫폼의 가용성 변경을 공지했습니다. fine-tuned model inference와 학습 작업의 종료 일정을 확인해야 합니다.",
      impact: "자체 fine-tuned 모델을 운영 중이면 신규 학습, 기존 모델 추론, 대체 경로 준비 일정에 직접 영향이 있습니다.",
      action: "fine-tuned model ID 사용처를 찾고, inference 종료일·새 fine-tuning 경로·대체 base model 후보를 정리하세요."
    };
  }
  if (/gpt-live|voice models|chatgpt voice/.test(lower)) {
    return {
      title: "OpenAI가 GPT-Live 음성 모델을 공개",
      change: "OpenAI가 ChatGPT Voice에 쓰이는 실시간 음성 상호작용용 모델 세대를 공개했습니다.",
      impact: "음성 상담, 실시간 인터뷰, 통역·코칭형 UX를 만드는 팀에는 Realtime/Voice 모델 평가 후보가 늘어납니다.",
      action: "기존 Realtime 모델 대비 지연시간, 음성 품질, 가격, 세션 유지 정책을 비교해 PoC 후보에 넣으세요."
    };
  }
  if (/gpt-realtime-2\.1|realtime reasoning/.test(lower)) {
    return {
      title: "OpenAI Realtime 모델 업데이트 확인",
      change: "OpenAI API 변경 로그에서 GPT-Realtime-2.1 및 mini 계열 변경을 확인했습니다.",
      impact: "음성·실시간 에이전트에서 알파뉴메릭 인식, 침묵/잡음 처리, 지연시간 체감이 달라질 수 있습니다.",
      action: "Realtime API를 쓰는 플로우가 있다면 기존 샘플 대화와 noisy 환경 테스트를 새 모델로 재실행하세요."
    };
  }
  if (/gpt[-\s]?5\.6|gpt-5\.6-sol|gpt-5\.6-terra|gpt-5\.6-luna/.test(lower)) {
    return {
      title: "OpenAI GPT-5.6 모델 패밀리 공개",
      change: "OpenAI 공식 모델 문서와 변경 로그에서 GPT-5.6 Sol, Terra, Luna 모델 패밀리와 gpt-5.6 alias 안내가 확인됐습니다.",
      impact: "복잡한 추론·코딩용 Sol, 비용 균형형 Terra, 고처리량용 Luna로 모델 선택 기준이 새로 생겼습니다.",
      action: "현재 GPT 계열 호출부에서 모델 alias, 비용, reasoning/tool 기능 지원 범위를 확인하고 평가 후보에 추가하세요."
    };
  }
  if (/claude sonnet 5|claude-sonnet-5/.test(lower)) {
    return {
      title: "Claude Sonnet 5 출시 및 가격 구간 확인",
      change: "Anthropic 릴리스 노트에서 Claude Sonnet 5 출시와 초기 가격 안내가 확인됐습니다.",
      impact: "Sonnet 계열을 코딩·문서·분석 워크로드에 쓰는 경우 성능/비용 기준점이 바뀔 수 있습니다.",
      action: "현재 Sonnet 사용량과 프롬프트 회귀 테스트를 기준으로 Sonnet 5 전환 후보를 평가하세요."
    };
  }
  if (/fable 5|mythos 5/.test(lower)) {
    return {
      title: "Claude Fable/Mythos 접근성 변경 확인",
      change: /statement.*directive.*suspend access|suspend access to fable 5 and mythos 5/.test(lower)
        ? "미국 정부 지침에 따라 Fable 5와 Mythos 5 접근 중단 관련 안내가 나왔습니다."
        : /mythos-preview.*retired|will be retired/.test(lower)
        ? "Claude Mythos Preview가 은퇴되고 Claude Mythos 5로 이전하라는 안내가 올라왔습니다."
        : excerpt || "Anthropic 문서와 뉴스에 Fable 5 및 Mythos 5 접근성·재배포 관련 변경이 올라왔습니다.",
      impact: "해당 모델을 직접 또는 Bedrock 경유로 쓰는 경우 지역·정책·안전장치에 따라 가용성이 달라질 수 있습니다.",
      action: "사용 중인 Claude 모델 ID와 공급 경로(API/Bedrock)를 대조하고 장애 시 대체 모델을 정해두세요."
    };
  }
  if (/gemini omni flash|nano banana 2 lite/.test(lower)) {
    return {
      title: "Gemini Omni Flash / Nano Banana 2 Lite 빌드 후보 추가",
      change: "Google Gemini 쪽에 빠른 멀티모달·이미지/비디오 생성 계열 모델 변경이 추가됐습니다.",
      impact: "이미지·영상 생성 워크플로의 비용, 속도, 대화형 편집 UX 후보가 늘어납니다.",
      action: "프로덕션 투입 전 preview 여부, quota, 워터마크/저작권 정책, 지역 제공 여부를 확인하세요."
    };
  }
  if (/interactions api.*ai studio|developer logs support for the interactions api/.test(lower)) {
    return {
      title: "Interactions API 로그를 AI Studio에서 확인 가능",
      change: "Google AI Studio 대시보드에서 지원되는 Interactions API 호출 로그를 볼 수 있게 됐습니다.",
      impact: "Gemini API 기반 에이전트나 인터랙션 흐름을 디버깅하는 팀은 호출 추적과 원인 분석이 쉬워질 수 있습니다.",
      action: "Interactions API를 쓰는 프로젝트가 있다면 AI Studio 로그에서 어떤 필드가 남는지, 보관 정책과 민감정보 노출 여부를 확인하세요."
    };
  }
  if (/computer use/.test(lower)) {
    return {
      title: "Gemini 3.5 Flash에 computer use 기능 공개",
      change: "Gemini 3.5 Flash 계열에 화면을 보고 클릭·입력·탐색하는 UI 자동화 기능이 추가됐습니다.",
      impact: "브라우저 조작형 에이전트, QA 자동화, 내부 업무 자동화 후보가 늘어납니다. 기존 도구 호출 방식과 권한·감사 설계를 같이 봐야 합니다.",
      action: "Gemini API 또는 Vertex AI에서 사용할 계획이 있다면 지원 리전, 안전장치, 작업 실패 시 복구 전략을 확인하세요."
    };
  }
  if (/live translate|voice translation/.test(lower)) {
    return {
      title: "Gemini 3.5 Live Translate 음성 번역 기능 공개",
      change: "Gemini 3.5 Live Translate 기반의 자연스러운 음성 번역 기능 소식이 확인됐습니다.",
      impact: "개발 API 변경보다는 Gemini 제품 기능 업데이트에 가깝지만, 음성·통역형 UX를 검토 중인 팀에는 참고할 만합니다.",
      action: "API에서 바로 쓸 수 있는 모델·엔드포인트 변경인지, 제품 기능 소식인지 원문에서 구분해 보세요."
    };
  }
  if (/spark|macos|connected apps/.test(lower)) {
    return {
      title: "Gemini 앱/클라이언트 기능 변경",
      change: "Gemini Spark의 macOS 출시와 연결 앱 관련 변경을 확인했습니다.",
      impact: "개발 API 변경이라기보다는 사용자용 Gemini 제품 경험 변화에 가깝습니다. 조직 내 Gemini 사용 가이드에 영향이 있을 수 있습니다.",
      action: "API 모델 변경과 분리해서 보고, 업무용 Gemini 앱을 쓰는 팀에만 공유하면 됩니다."
    };
  }
  if (/bedrock agents.*classic|no longer be open to new customers.*july 30, 2026/.test(lower)) {
    return {
      title: "Amazon Bedrock Agents Classic 신규 고객 제한 예정",
      change: "Amazon Bedrock Agents가 Agents Classic으로 바뀌며, 2026년 7월 30일부터 신규 고객에게 열리지 않는다는 안내가 추가됐습니다.",
      impact: "기존 Agents Classic 사용자는 당장 중단은 아니지만, 신규 구축이나 마이그레이션 계획에는 영향을 줄 수 있습니다.",
      action: "Bedrock Agents를 새로 도입하려는 팀이 있다면 권장 경로와 기존 Agents Classic 사용 범위를 문서에서 확인하세요."
    };
  }
  if (/bedrock guardrails.*cross-region inference|cross-region inference.*additional regions/.test(lower)) {
    return {
      title: "Bedrock Guardrails 교차 리전 추론 리전 확대",
      change: "Amazon Bedrock Guardrails의 교차 리전 추론 지원 리전이 추가됐습니다.",
      impact: "멀티리전 Bedrock 구성을 쓰는 팀은 Guardrails 적용 범위와 지연시간·데이터 이동 조건을 다시 볼 필요가 있습니다.",
      action: "사용 중인 리전이 새 지원 목록에 들어갔는지 확인하고, 보안·규정 준수 요구사항과 함께 점검하세요."
    };
  }
  if (/asynchronous model invocation.*batch inference|multiple prompts with batch inference/.test(lower)) {
    return {
      title: "Batch inference 비동기 모델 호출 정식 지원",
      change: "Amazon Bedrock에서 batch inference를 통한 다중 프롬프트 비동기 모델 호출이 정식 제공됩니다.",
      impact: "대량 요약·분류·생성 작업처럼 실시간 응답이 꼭 필요하지 않은 워크로드의 비용과 처리량 설계에 영향을 줄 수 있습니다.",
      action: "배치 처리 후보 워크로드를 골라 지원 모델, 입력 형식, 실패 재시도 방식, 비용을 확인하세요."
    };
  }
  if (/custom model import.*open ?ai gpt-oss|gpt-oss models/.test(lower)) {
    return {
      title: "커스텀 모델 가져오기에서 OpenAI GPT-OSS 지원",
      change: "Amazon Bedrock의 custom model import가 OpenAI GPT-OSS 모델을 지원한다는 변경이 확인됐습니다.",
      impact: "자체 호스팅 대신 Bedrock 관리 환경에서 오픈 모델을 운영하려는 팀에는 선택지가 늘어납니다.",
      action: "지원되는 GPT-OSS 모델 버전, 라이선스, 리전, 추론 비용과 기존 배포 방식의 차이를 비교하세요."
    };
  }
  if (/vertex ai documentation is no longer being updated|gemini enterprise agent platform/.test(lower)) {
    return {
      title: "Vertex AI 생성형 AI 문서 경로 변경",
      change: "Vertex AI 생성형 AI 문서가 Gemini Enterprise Agent Platform 문서로 이동·통합되는 흐름이 확인됩니다.",
      impact: "Vertex AI 기반 구현을 문서 기준으로 운영하는 팀은 최신 안내 위치가 바뀌어 deprecated 문서를 참조할 위험이 있습니다.",
      action: "내부 위키, 런북, 링크 모음을 Gemini Enterprise Agent Platform 최신 문서 기준으로 갱신하세요."
    };
  }
  if (/deprecat|retir|sunset|legacy|shut.?down|end.of.life/.test(lower) || event.kind === "deprecation") {
    return {
      title: `${vendorLabels[event.vendor] || event.vendor} 모델 수명주기 변경`,
      change: models ? `지원 종료 또는 모델 수명주기 변경을 확인했습니다. 관련 모델: ${models}.` : excerpt || "공식 문서에서 지원 종료 또는 모델 수명주기 관련 변경을 확인했습니다.",
      impact: "운영 중인 모델 호출, Bedrock/Vertex 경유 사용, alias 기반 호출이 있다면 예고 없이 비용·품질·가용성 리스크로 이어질 수 있습니다.",
      action: "현재 사용 중인 모델 ID와 alias를 대조하고, 대체 모델·마이그레이션 마감일·리전별 제공 여부를 확인하세요."
    };
  }
  if (/price|pricing|billing|cost/.test(lower) || event.kind === "pricing") {
    return {
      title: `${vendorLabels[event.vendor] || event.vendor} 가격/과금 변경`,
      change: excerpt || "공식 문서에서 가격 또는 과금 방식 관련 변경을 확인했습니다.",
      impact: "대량 호출, Batch, tool 사용, 장기 세션이 있는 워크로드는 월 비용 추정이 달라질 수 있습니다.",
      action: "최근 사용량 기준으로 비용 민감도가 큰 엔드포인트부터 재계산하고 예산 알림 기준을 조정하세요."
    };
  }
  if (/released|introduc|launch|generally available|preview|new model|start building/.test(lower) || event.kind === "release") {
    return {
      title: readableTitle,
      change: releaseChange(event, readableTitle, excerpt),
      impact: models ? `관련 모델(${models})을 평가 후보에 추가할 수 있습니다.` : releaseImpact(event),
      action: releaseAction(event)
    };
  }
  return {
    title: readableTitle,
    change: excerpt || `${sourceLabels[event.sourceId] || event.sourceId}에서 문서 변경을 확인했습니다.`,
    impact: "현재 사용 중인 모델 또는 플랫폼과 직접 관련되는지 먼저 선별하면 됩니다.",
    action: "원문을 열어 API/모델 ID/마감일/리전 등 운영 영향 필드가 있는지 확인하세요."
  };
}

function earlyRuleBriefing(event) {
  const lower = [
    event.title,
    event.summary,
    event.titleKo,
    event.summaryKo,
    event.briefKo?.title,
    event.briefKo?.change,
    event.briefKo?.impact,
    event.briefKo?.action
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").toLowerCase();
  if (/interactions api.*ai studio|developer logs support for the interactions api/.test(lower)) {
    return {
      title: "Interactions API 로그를 AI Studio에서 확인 가능",
      change: "Google AI Studio 대시보드에서 지원되는 Interactions API 호출 로그를 볼 수 있게 됐습니다.",
      impact: "Gemini API 기반 에이전트나 인터랙션 흐름을 디버깅하는 팀은 호출 추적과 원인 분석이 쉬워질 수 있습니다.",
      action: "Interactions API를 쓰는 프로젝트가 있다면 AI Studio 로그에서 어떤 필드가 남는지, 보관 정책과 민감정보 노출 여부를 확인하세요."
    };
  }
  if (/bedrock agents.*classic|no longer be open to new customers.*july 30, 2026/.test(lower)) {
    return {
      title: "Amazon Bedrock Agents Classic 신규 고객 제한 예정",
      change: "Amazon Bedrock Agents가 Agents Classic으로 바뀌며, 2026년 7월 30일부터 신규 고객에게 열리지 않는다는 안내가 추가됐습니다.",
      impact: "기존 Agents Classic 사용자는 당장 중단은 아니지만, 신규 구축이나 마이그레이션 계획에는 영향을 줄 수 있습니다.",
      action: "Bedrock Agents를 새로 도입하려는 팀이 있다면 권장 경로와 기존 Agents Classic 사용 범위를 문서에서 확인하세요."
    };
  }
  if (/bedrock guardrails.*cross-region inference|cross-region inference.*additional regions/.test(lower)) {
    return {
      title: "Bedrock Guardrails 교차 리전 추론 리전 확대",
      change: "Amazon Bedrock Guardrails의 교차 리전 추론 지원 리전이 추가됐습니다.",
      impact: "멀티리전 Bedrock 구성을 쓰는 팀은 Guardrails 적용 범위와 지연시간·데이터 이동 조건을 다시 볼 필요가 있습니다.",
      action: "사용 중인 리전이 새 지원 목록에 들어갔는지 확인하고, 보안·규정 준수 요구사항과 함께 점검하세요."
    };
  }
  if (/intelligent prompt routing/.test(lower)) {
    return {
      title: "Bedrock intelligent prompt routing 정식 지원",
      change: "Amazon Bedrock에서 intelligent prompt routing이 정식 제공됩니다.",
      impact: "요청 성격에 따라 모델 라우팅을 조정하는 구성을 검토 중이면 비용·지연시간·품질 균형을 다시 잡을 수 있습니다.",
      action: "지원 모델, 라우팅 기준, 실패 시 fallback 동작, 기존 프롬프트 라우터와의 차이를 확인하세요."
    };
  }
  if (/graph\s?rag.*bedrock knowledge bases/.test(lower)) {
    return {
      title: "Bedrock Knowledge Bases Graph RAG 정식 지원",
      change: "Amazon Bedrock Knowledge Bases의 Graph RAG 기능이 추가 기능과 함께 정식 제공됩니다.",
      impact: "복잡한 관계형 지식을 검색·생성에 함께 쓰는 RAG 구성을 검토 중이면 후보 아키텍처가 늘어납니다.",
      action: "기존 vector RAG와 비교해 지원 데이터 소스, 그래프 구성 방식, 쿼리 품질, 비용을 확인하세요."
    };
  }
  if (/amazon bedrock flows.*generally available|flows is now generally available/.test(lower)) {
    return {
      title: "Amazon Bedrock Flows 정식 지원",
      change: "Amazon Bedrock Flows가 정식 제공됩니다.",
      impact: "Bedrock 기반 워크플로를 시각적으로 구성하거나 운영 자동화하려는 팀에는 더 안정적인 도입 후보가 됩니다.",
      action: "기존 Step Functions·자체 오케스트레이션과 비교해 지원 노드, 권한, 로깅, 비용 구조를 확인하세요."
    };
  }
  if (/asynchronous model invocation.*batch inference|multiple prompts with batch inference/.test(lower)) {
    return {
      title: "Batch inference 비동기 모델 호출 정식 지원",
      change: "Amazon Bedrock에서 batch inference를 통한 다중 프롬프트 비동기 모델 호출이 정식 제공됩니다.",
      impact: "대량 요약·분류·생성 작업처럼 실시간 응답이 꼭 필요하지 않은 워크로드의 비용과 처리량 설계에 영향을 줄 수 있습니다.",
      action: "배치 처리 후보 워크로드를 골라 지원 모델, 입력 형식, 실패 재시도 방식, 비용을 확인하세요."
    };
  }
  if (/inline code nodes|run code directly in your amazon bedrock flow/.test(lower)) {
    return {
      title: "Bedrock Flow에서 인라인 코드 노드 프리뷰",
      change: "Amazon Bedrock Flow 안에서 인라인 코드 노드로 코드를 직접 실행하는 프리뷰 기능이 추가됐습니다.",
      impact: "Flow 기반 오케스트레이션에 간단한 변환·검증 로직을 넣을 수 있지만, 프리뷰 기능이라 운영 적용 전 제약 확인이 필요합니다.",
      action: "지원 언어, 실행 제한, 권한, 로깅 방식과 프리뷰 SLA를 확인한 뒤 실험 환경에서만 테스트하세요."
    };
  }
  if (/custom model import.*open ?ai gpt-oss|gpt-oss models/.test(lower)) {
    return {
      title: "커스텀 모델 가져오기에서 OpenAI GPT-OSS 지원",
      change: "Amazon Bedrock의 custom model import가 OpenAI GPT-OSS 모델을 지원한다는 변경이 확인됐습니다.",
      impact: "자체 호스팅 대신 Bedrock 관리 환경에서 오픈 모델을 운영하려는 팀에는 선택지가 늘어납니다.",
      action: "지원되는 GPT-OSS 모델 버전, 라이선스, 리전, 추론 비용과 기존 배포 방식의 차이를 비교하세요."
    };
  }
  return null;
}

function releaseChange(event, readableTitle, excerpt) {
  if (event.sourceId === "anthropic-news") {
    const subject = readableTitle.replace(/\s*공개$/, "");
    return `${providerSubject(event.vendor)} ${subject}${objectParticle(subject)} 공개했습니다.`;
  }
  return excerpt || "신규 모델 또는 기능 출시 소식입니다.";
}

function releaseImpact(event) {
  if (event.sourceId === "anthropic-news") {
    return /tag|reflect|conversation|office|trust|partnership/i.test(event.title || "")
      ? "API 모델 변경이라기보다 제품·회사 소식에 가까워, 운영 영향은 낮게 보면 됩니다."
      : "Claude 제품 또는 생태계 변화로, API 사용과 직접 관련되는지 선별해서 보면 됩니다.";
  }
  return "성능·비용·지연시간 개선 후보가 생겼지만, preview/experimental 여부를 확인해야 합니다.";
}

function releaseAction(event) {
  if (event.sourceId === "anthropic-news") {
    return "모델 ID, API 변경, 가격·리전 변경이 포함됐는지만 원문에서 빠르게 확인하세요.";
  }
  return "바로 교체하기보다 샘플 프롬프트, 비용, rate limit, 리전 제공 여부를 체크리스트로 비교하세요.";
}

function isBriefingCandidate(event) {
  const title = normalizeTitle(event.title);
  const source = event.sourceId || "";
  const text = `${event.title} ${event.summary}`.toLowerCase();
  if (!title || title.length < 4) return false;
  if (/^(latest|experimental|active versions|latest models comparison|model cards|models|overview|documentation|table of contents|notifications|best practices|deprecation history|past deprecations|deprecation vs\.? legacy|migrating to replacements|auditing model usage|api parameter deprecations|model deprecation notice periods)$/i.test(title)) return false;
  if (/^(home|documentation|resources|send feedback|api|topics|programs|spaces|core concepts|tools|guides|learn|plan|build|deploy|configuration|administration)$/i.test(title)) return false;
  if (/government and national security|educators|workforce opportunity|payments plus|mufg|case study|personalized image creation/i.test(title)) return false;
  if (/listed below|we use the term|notifies customers|regularly check|deprecated parameters remain|deprecates and retires models to ensure capacity|advance notice before retiring/.test(text)) return false;
  if (/deprecations/.test(source) && !event.publishedAt && !event.modelIds?.length && !/(update|retire|retired|will be|until|deadline|migrate to|replaced by)/.test(text)) return false;
  if (source.endsWith("-models") && event.kind === "models" && !/(preview|released|new|deprecat|imagen|gemini|claude|gpt|veo|lyria|computer use)/.test(text)) {
    return false;
  }
  if (source === "bedrock-lifecycle" && /active versions/i.test(event.title)) return false;
  if (event.kind === "news" && isLowPriorityNews(event)) return false;
  if (event.kind === "news" && !/(gpt|claude|gemini|model|coding|benchmark|voice|realtime|sonnet|fable|mythos|omni|nano banana|computer use|api|codex)/i.test(`${event.title} ${event.summary}`)) return false;
  return true;
}

function isLowPriorityNews(event) {
  const text = `${event.title} ${event.summary}`.toLowerCase();
  return /case study|customer story|deutsche telekom|telco|bio bounty|bug bounty|partner for your most ambitious work|coding evaluations|swe-bench|benchmark reliability|seoul office|appointed|trust|partnership|\bpartner\b|public record|hard questions|pixel drop|new features for creators|smarter, more proactive android|android with gemini intelligence/.test(text);
}

function briefingScore(event) {
  const source = event.sourceId || "";
  const text = `${event.title} ${event.summary}`.toLowerCase();
  let score = event.severity || 0;
  if (event.urgency === "high") score += 40;
  if (event.urgency === "low") score -= 25;
  if (event.isProbablyNoise || event.summaryMeta?.isProbablyNoise) score -= 120;
  if (event.changeType === "new_model") score += 25;
  if (event.changeType === "api_change") score += 22;
  if (event.changeType === "availability") score += 16;
  if (event.changeType === "docs_only" || event.changeType === "product_news") score -= 20;
  if (event.kind === "deprecation") score += 35;
  if (event.kind === "breaking-change") score += 30;
  if (event.kind === "pricing") score += 24;
  if (event.kind === "release") score += 18;
  if (/changelog|release-notes|doc-history|deprecations|news/.test(source)) score += 16;
  if (/released|introduc|launch|preview|generally available|deprecat|retir|pricing|billing|computer use/i.test(text)) score += 14;
  if (/gpt[-\s]?5\.6|gpt-5\.6-sol|gpt-5\.6-terra|gpt-5\.6-luna/.test(text)) score += 100;
  if (/gpt[-\s]?5\.6/.test((event.title || "").toLowerCase())) score += 80;
  if (/^(get started|overview|documentation)$/i.test(event.title || "")) score -= 120;
  if (event.modelIds?.length) score += 6;
  score += Math.max(0, 10 - Math.floor((Date.now() - eventTime(event)) / 86_400_000));
  return score;
}

function recentListScore(event) {
  const detected = event.detectedAt ? new Date(event.detectedAt) : null;
  const detectedTime = detected && !Number.isNaN(detected.valueOf()) ? detected.valueOf() : eventTime(event);
  const dayBucket = Math.floor(detectedTime / 86_400_000);
  return dayBucket * 1_000 + briefingScore(event);
}

function usefulExcerpt(event) {
  const text = cleanForBrief(`${event.summary || ""}`);
  if (!text || normalizeTitle(text) === normalizeTitle(event.title)) return "";
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const sentence = sentences.find((item) => item.length > 35) || sentences[0] || text;
  return sentence.slice(0, 180);
}

function cleanForBrief(value) {
  return stripNewsChrome(value)
    .replace(/\s+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b(Home|Documentation|Resources|Send feedback)\b/g, "")
    .trim();
}

function stripNewsChrome(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})(Announcements|Product|Feature|Features|Case Study)/i, "")
    .replace(/^(Announcements|Product|Feature|Features|Case Study)((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}, \d{4})/i, "")
    .replace(/^(Announcements|Product|Feature|Features|Case Study)\b/i, "")
    .trim();
}

function normalizeTitle(value = "") {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeSearch(value = "") {
  return value.toLowerCase().replace(/[\s._-]+/g, "");
}

function cardTitle(event) {
  if (event.titleKo) return cleanDisplayTitle(event.titleKo, event);
  if (event.briefKo?.title) return cleanDisplayTitle(event.briefKo.title, event);
  const brief = isBriefingCandidate(event) ? briefing(event) : null;
  if (brief?.title && !/관련 공지$/.test(brief.title)) return brief.title;
  return readableOriginalTitle(event);
}

function cardSummary(event) {
  if (event.summaryKo) return naturalizeBriefText(event.summaryKo, event);
  if (event.briefKo?.change) return naturalizeBriefText(event.briefKo.change, event);
  const brief = isBriefingCandidate(event) ? briefing(event) : null;
  const action = brief?.action ? ` 확인할 일: ${brief.action}` : "";
  if (brief?.change && !/업데이트가 올라왔습니다|공식 문서에/.test(brief.change)) {
    return `${brief.change}${action}`.slice(0, 900);
  }
  const excerpt = usefulExcerpt(event);
  const models = event.modelIds?.length ? ` 관련 모델: ${event.modelIds.slice(0, 4).join(", ")}.` : "";
  if (excerpt) return `${naturalizeExcerpt(excerpt)}${models}`.slice(0, 900);
  return `${sourceLabels[event.sourceId] || "공식 문서"}에서 확인할 변경사항입니다.${models}`.slice(0, 900);
}

function readableOriginalTitle(event) {
  return cleanDisplayTitle(koreanizeTitle(event), event);
}

function uniqueRecentEvents(items) {
  const seen = new Set();
  const result = [];
  for (const event of items) {
    const key = event.clusterKey || event.summaryMeta?.clusterKey || `${event.vendor}|${normalizeTitle(cardTitle(event))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }
  return result;
}

function naturalizeExcerpt(value) {
  return stripNewsChrome(value)
    .replace(/^(Overview|Quickstart|Models|Pricing|SDKs and CLI|OpenAI SDK|Agents SDK|OpenAI CLI)\s+/i, "")
    .replace(/([a-z])([A-Z][a-z])/g, "$1 $2")
    .trim();
}

function koreanizeTitle(event) {
  const title = stripNewsChrome(event.title || "");
  const replacements = [
    [/^Introducing a way to reflect on how you use Claude$/i, "Claude 사용 방식을 돌아보는 기능 공개"],
    [/^Introducing Claude Tag$/i, "Claude Tag 공개"],
    [/^The Making of Claude Code$/i, "Claude Code 제작기"],
    [/^Redeploying Fable 5$/i, "Fable 5 재배포"],
    [/^Introducing Claude Sonnet 5$/i, "Claude Sonnet 5 공개"],
    [/^Claude Science, an AI workbench for scientists, is now available$/i, "과학자를 위한 Claude Science 공개"],
    [/^GPT-5\.5 Bio Bug Bounty$/i, "GPT-5.5 Bio 버그 바운티 안내"],
    [/^How Deutsche Telekom is rewiring telecommunications with AI$/i, "Deutsche Telekom의 AI 전환 사례"],
    [/^ChatGPT is now a partner for your most ambitious work$/i, "ChatGPT 업무 에이전트 기능 공개"],
    [/^Separating signal from noise in coding evaluations$/i, "코딩 벤치마크 평가 신뢰도 분석"],
    [/^Latest models comparison$/i, "최신 모델 비교"],
    [/^Model deprecations$/i, "모델 지원 종료"],
    [/^Active versions$/i, "활성 모델 버전"],
    [/^Document history/i, "문서 변경 이력"],
    [/^New model$/i, "신규 모델"],
    [/^New models$/i, "신규 모델"],
    [/^New feature$/i, "신규 기능"],
    [/^Region expansion$/i, "지원 리전 확대"],
    [/^Updated managed policy$/i, "관리형 정책 업데이트"],
    [/Deprecated/i, "지원 종료"],
    [/Deprecation/i, "지원 종료"],
    [/Released/i, "출시"],
    [/^Introducing (.+)$/i, "$1 공개"],
    [/Start building with/i, "빌드 시작:"]
  ];
  let value = title;
  for (const [pattern, replacement] of replacements) value = value.replace(pattern, replacement);
  if (value !== title) return value;
  if (event.kind === "deprecation") return "지원 종료 또는 수명주기 변경";
  if (event.kind === "release") return "새 모델·기능 출시";
  if (event.kind === "pricing") return "가격·과금 변경";
  return title;
}

function cleanDisplayTitle(value, event) {
  let title = stripNewsChrome(value || "")
    .replace(/([a-z])([A-Z][a-z])/g, "$1 $2")
    .replace(/^Introducing a way to reflect on how you use Claude$/i, "Claude 사용 방식을 돌아보는 기능 공개")
    .replace(/^Introducing Claude Tag$/i, "Claude Tag 공개")
    .replace(/^GPT-5\.5 Bio Bug Bounty$/i, "GPT-5.5 Bio 버그 바운티 안내")
    .replace(/^How Deutsche Telekom is rewiring telecommunications with AI$/i, "Deutsche Telekom의 AI 전환 사례")
    .replace(/^ChatGPT is now a partner for your most ambitious work$/i, "ChatGPT 업무 에이전트 기능 공개")
    .replace(/^Separating signal from noise in coding evaluations$/i, "코딩 벤치마크 평가 신뢰도 분석")
    .replace(/^Introducing (.+)$/i, "$1 공개")
    .trim();
  return title || koreanizeTitle(event || {});
}

function naturalizeBriefText(value, event) {
  let text = cleanForBrief(value || "")
    .replace(/공식 출처에 신규 모델 또는 기능 출시 소식이 올라왔습니다\.?/g, "신규 모델 또는 기능 출시 소식입니다.")
    .replace(/공식 문서에 새 업데이트가 올라왔습니다\.?/g, "공식 문서의 변경 내용을 확인했습니다.")
    .replace(/업데이트가 올라왔습니다\.?/g, "변경사항이 확인됐습니다.")
    .replace(/확인할 필요가 있습니다/g, "확인해야 합니다")
    .replace(/Anthropic가/g, "Anthropic이")
    .replace(/OpenAI이/g, "OpenAI가")
    .replace(/Google가/g, "Google이")
    .replace(/Amazon Bedrock가/g, "Amazon Bedrock이")
    .replace(/preview\/experimental/g, "프리뷰/실험 단계")
    .trim();
  if (/^(Introducing|Product|Announcements|Feature|Case Study)/i.test(text)) {
    return `${providerSubject(event?.vendor)} ${cleanDisplayTitle(event?.title || "", event)} 소식을 공개했습니다.`;
  }
  return text;
}

function providerSubject(vendor) {
  return {
    openai: "OpenAI가",
    anthropic: "Anthropic이",
    google: "Google이",
    aws: "Amazon Bedrock이"
  }[vendor] || "공급사가";
}

function objectParticle(value = "") {
  const trimmed = String(value).trim();
  const last = trimmed.charCodeAt(trimmed.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "를";
  return (last - 0xac00) % 28 === 0 ? "를" : "을";
}

function koreanizeSummary(event) {
  const vendor = vendorLabels[event.vendor] || event.vendor;
  const source = sourceLabels[event.sourceId] || event.sourceId;
  const kind = labels[event.kind] || event.kind;
  const models = event.modelIds.length ? ` 관련 모델은 ${event.modelIds.slice(0, 5).join(", ")}입니다.` : "";
  const excerpt = shouldShowExcerpt(event) && event.summary ? ` 원문 핵심: ${cleanForBrief(event.summary)}` : "";
  const lead = summaryLead(event, vendor, source, kind);
  return `${lead}${models}${excerpt}`.slice(0, 1000);
}

function summaryLead(event, vendor, source, kind) {
  if (event.sourceId === "bedrock-lifecycle") {
    return "Amazon Bedrock 모델 수명주기 문서가 바뀌었습니다. Bedrock 경유로 쓰는 모델의 활성·레거시·종료 상태를 확인하세요.";
  }
  if (event.sourceId === "bedrock-doc-history") {
    return "Amazon Bedrock 문서 변경 이력에 새 항목이 추가됐습니다. 새 모델, 리전, 기능 지원 여부를 확인할 만한 변경입니다.";
  }
  if (event.sourceId?.includes("deprecations")) {
    return `${vendor}의 ${source} 문서에서 ${kind} 관련 변경이 확인됐습니다. 사용 중인 모델이나 API가 포함되는지 먼저 확인하세요.`;
  }
  if (event.kind === "release") {
    return `${vendor}의 ${source}에서 신규 출시 소식을 확인했습니다. 평가 후보로 볼 만한 모델이나 기능인지 확인하세요.`;
  }
  if (event.kind === "pricing") {
    return `${vendor}의 ${source}에서 가격 또는 과금 관련 변경이 확인됐습니다. 사용량이 큰 워크로드의 비용 영향을 확인하세요.`;
  }
  if (event.kind === "breaking-change") {
    return `${vendor}의 ${source}에서 호환성에 영향을 줄 수 있는 변경을 확인했습니다. 적용 일정과 기존 연동 영향을 확인하세요.`;
  }
  return `${vendor}의 ${source}에서 ${kind} 관련 변경을 확인했습니다. 현재 사용하는 모델·API와 관련이 있는지 확인하세요.`;
}

function shouldShowExcerpt(event) {
  if (event.sourceId === "bedrock-lifecycle") return false;
  if (event.sourceId?.endsWith("-models") && event.summary?.length > 260) return false;
  if (event.kind === "deprecation" && event.modelIds?.length) return false;
  return true;
}

function formatDateTime(value) {
  return value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "기록 없음";
}

function shortDate(value) {
  return value ? new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(new Date(value)) : "날짜 없음";
}

function fullDate(value) {
  return value ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "numeric", day: "numeric" }).format(new Date(value)) : "날짜 없음";
}

function dateBadge(event) {
  if (event.publishedAt && isFutureDate(event.publishedAt)) {
    return `적용 ${fullDate(event.publishedAt)}`;
  }
  if (event.publishedAt) {
    return `공개 ${shortDate(event.publishedAt)}`;
  }
  if (event.detectedAt) {
    return `수집 ${shortDate(event.detectedAt)}`;
  }
  return "날짜 없음";
}

function cardDateLabel(event) {
  const collected = formatDateTime(event.detectedAt);
  if (event.publishedAt && isFutureDate(event.publishedAt)) {
    return `수집 ${collected} · 적용 ${event.publishedAt}`;
  }
  return event.publishedAt || collected;
}

function displayDate(event) {
  if (event.publishedAt && !isFutureDate(event.publishedAt)) return event.publishedAt;
  return event.detectedAt;
}

function eventDate(event) {
  const value = displayDate(event);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function eventDateForBriefing(event) {
  if (event.publishedAt && !isFutureDate(event.publishedAt)) return eventDate(event);
  if (/news|doc-history|changelog|release-notes/.test(event.sourceId || "")) return eventDate(event);
  return null;
}

function eventTime(event) {
  return eventDate(event)?.valueOf() || 0;
}

function isFutureDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return false;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return date >= tomorrow;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
