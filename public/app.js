const [events, state] = await Promise.all([
  fetch("./data/events.json?v=20260710-2").then((response) => response.json()),
  fetch("./data/state.json?v=20260710-2").then((response) => response.json())
]);

const ui = {
  events: document.querySelector("#events"),
  template: document.querySelector("#eventTemplate"),
  vendorFilters: document.querySelector("#vendorFilters"),
  kindFilter: document.querySelector("#kindFilter"),
  search: document.querySelector("#search"),
  resultCount: document.querySelector("#resultCount"),
  health: document.querySelector("#health"),
  coverage: document.querySelector("#coverage"),
  headlines: document.querySelector("#headlines"),
  headlineMeta: document.querySelector("#headlineMeta")
};

const filters = { vendor: "", kind: "", search: "" };
const RECENT_LIMIT = 5;
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
  google: "Google",
  aws: "AWS"
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

const vendors = [...new Set(events.map((event) => event.vendor))].sort();
for (const [value, label] of [["", "전체"], ...vendors.map((vendor) => [vendor, vendorLabels[vendor] || vendor])]) {
  const button = document.createElement("button");
  button.textContent = label;
  button.className = value === "" ? "active" : "";
  button.addEventListener("click", () => {
    filters.vendor = value;
    [...ui.vendorFilters.children].forEach((child) => child.classList.toggle("active", child === button));
    render();
  });
  ui.vendorFilters.append(button);
}

ui.kindFilter.addEventListener("change", (event) => {
  filters.kind = event.target.value;
  render();
});
ui.search.addEventListener("input", (event) => {
  filters.search = normalizeSearch(event.target.value);
  render();
});

const sourceStates = Object.values(state.sources || {});
const failures = sourceStates.filter((source) => !source.ok);
ui.health.textContent = failures.length
  ? `수집기 ${failures.length}개 확인 필요`
  : `마지막 수집 ${formatDateTime(state.lastRunAt)}`;
ui.health.classList.add(failures.length ? "bad" : "ok");

renderCoverage();
renderHeadlines();
render();

function render() {
  const matched = events.filter((event) => {
    const haystack = normalizeSearch(`${event.title} ${event.summary} ${event.titleKo || ""} ${event.summaryKo || ""} ${event.modelIds.join(" ")}`);
    return (!filters.vendor || event.vendor === filters.vendor)
      && (!filters.kind || event.kind === filters.kind)
      && (!filters.search || haystack.includes(filters.search));
  }).sort((a, b) => recentListScore(b) - recentListScore(a));
  const visible = matched.slice(0, RECENT_LIMIT);
  ui.events.replaceChildren(...visible.map(card));
  ui.resultCount.textContent = `${matched.length.toLocaleString("ko-KR")}건 중 핵심 ${visible.length.toLocaleString("ko-KR")}건 표시`;
}

function card(event) {
  const article = document.createElement("article");
  article.className = "event-card";
  article.classList.add(event.kind);
  const titleKo = event.titleKo || koreanizeTitle(event);
  const models = Array.isArray(event.modelIds) ? event.modelIds : [];
  article.innerHTML = `
    <div class="event-top">
      <div>
        <span class="vendor">${escapeHtml(vendorLabels[event.vendor] || event.vendor)} · ${escapeHtml(event.platform || "")}</span>
        <span class="source">${escapeHtml(sourceLabels[event.sourceId] || event.sourceId || "")}</span>
      </div>
      <span class="kind">${escapeHtml(labels[event.kind] || event.kind || "")}</span>
    </div>
    <h3>${escapeHtml(titleKo)}</h3>
    <p class="original-title">${titleKo === event.title ? "" : `원문: ${escapeHtml(event.title || "")}`}</p>
    <p class="summary">${escapeHtml(event.summaryKo || koreanizeSummary(event))}</p>
    <div class="models">${models.slice(0, 8).map((model) => `<span class="model">${escapeHtml(model)}</span>`).join("")}</div>
    <footer>
      <span class="date">${escapeHtml(cardDateLabel(event))}</span>
      <a href="${escapeHtml(event.sourceUrl || "#")}" target="_blank" rel="noreferrer">원문 보기 ↗</a>
    </footer>
  `;
  return article;
}

function renderCoverage() {
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

  ui.coverage.innerHTML = [...byVendor.values()]
    .sort((a, b) => vendorSort(a.vendor) - vendorSort(b.vendor))
    .map((item) => {
      const pool = (item.recent.length ? item.recent : item.fallback)
        .sort((a, b) => briefingScore(b) - briefingScore(a));
      const primary = pool[0];
      const brief = primary ? briefing(primary) : null;
      const sourceList = [...item.sources].map((id) => sourceLabels[id] || id).join(", ");
      const status = item.recent.length
        ? `최근 7일 주요 이슈 ${item.recent.length.toLocaleString("ko-KR")}건`
        : "최근 7일 주요 이슈 없음";
      return `
        <article class="coverage-card">
          <div class="coverage-top">
            <strong>${vendorLabels[item.vendor] || item.vendor}</strong>
            <span>${status}</span>
          </div>
          <h3>${escapeHtml(brief?.title || "특이 업데이트 없음")}</h3>
          <p class="coverage-summary">${escapeHtml(brief ? `${brief.change} ${brief.action}` : "공식 문서는 정상 수집 중입니다. 새로 확인할 만한 주요 변경은 아직 없습니다.")}</p>
          <p class="coverage-sources">${escapeHtml(sourceList)}</p>
        </article>
      `;
    }).join("");
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
    const key = `${event.vendor}|${normalizeTitle(candidateBrief.title)}`;
    if (headlines.some((item) => `${item.vendor}|${normalizeTitle(briefing(item).title)}` === key)) continue;
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
  const models = Array.isArray(event.modelIds) ? event.modelIds.slice(0, 3) : [];
  const brief = briefing(event);
  article.innerHTML = `
    <div class="headline-rank">${String(index + 1)}</div>
    <div class="headline-body">
      <div class="headline-meta">
        <span>${escapeHtml(vendorLabels[event.vendor] || event.vendor)}</span>
        <span>${escapeHtml(labels[event.kind] || event.kind || "")}</span>
        <span>${escapeHtml(shortDate(displayDate(event)))}</span>
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
  if (event.briefKo) {
    return {
      title: event.briefKo.title || event.titleKo || koreanizeTitle(event),
      change: event.briefKo.change || event.summaryKo || usefulExcerpt(event) || "공식 문서에 새 업데이트가 올라왔습니다.",
      impact: event.briefKo.impact || event.impactKo || "현재 사용 중인 모델 또는 플랫폼과 직접 관련되는지 확인할 필요가 있습니다.",
      action: event.briefKo.action || event.actionKo || "원문에서 모델 ID, 적용일, 마이그레이션 안내를 확인하세요."
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
      change: "ChatGPT Voice에 쓰이는 자연스러운 실시간 음성 상호작용용 모델 세대가 공개되었습니다.",
      impact: "음성 상담, 실시간 인터뷰, 통역·코칭형 UX를 만드는 팀에는 Realtime/Voice 모델 평가 후보가 늘어납니다.",
      action: "기존 Realtime 모델 대비 지연시간, 음성 품질, 가격, 세션 유지 정책을 비교해 PoC 후보에 넣으세요."
    };
  }
  if (/gpt-realtime-2\.1|realtime reasoning/.test(lower)) {
    return {
      title: "OpenAI Realtime 모델 업데이트 확인",
      change: "GPT-Realtime-2.1 및 mini 계열 업데이트가 OpenAI API 변경 로그에 올라왔습니다.",
      impact: "음성·실시간 에이전트에서 알파뉴메릭 인식, 침묵/잡음 처리, 지연시간 체감이 달라질 수 있습니다.",
      action: "Realtime API를 쓰는 플로우가 있다면 기존 샘플 대화와 noisy 환경 테스트를 새 모델로 재실행하세요."
    };
  }
  if (/gpt[-\s]?5\.6|gpt-5\.6-sol|gpt-5\.6-terra|gpt-5\.6-luna/.test(lower)) {
    return {
      title: "OpenAI GPT-5.6 모델 패밀리 공개",
      change: "OpenAI 공식 모델 문서와 변경 로그에 GPT-5.6 Sol, Terra, Luna 모델 패밀리와 gpt-5.6 alias 안내가 올라왔습니다.",
      impact: "복잡한 추론·코딩용 Sol, 비용 균형형 Terra, 고처리량용 Luna로 모델 선택 기준이 새로 생겼습니다.",
      action: "현재 GPT 계열 호출부에서 모델 alias, 비용, reasoning/tool 기능 지원 범위를 확인하고 평가 후보에 추가하세요."
    };
  }
  if (/claude sonnet 5|claude-sonnet-5/.test(lower)) {
    return {
      title: "Claude Sonnet 5 출시 및 가격 구간 확인",
      change: "Anthropic 릴리스 노트에 Claude Sonnet 5 출시와 초기 가격 안내가 올라왔습니다.",
      impact: "Sonnet 계열을 코딩·문서·분석 워크로드에 쓰는 경우 성능/비용 기준점이 바뀔 수 있습니다.",
      action: "현재 Sonnet 사용량과 프롬프트 회귀 테스트를 기준으로 Sonnet 5 전환 후보를 평가하세요."
    };
  }
  if (/fable 5|mythos 5/.test(lower)) {
    return {
      title: "Claude Fable/Mythos 접근성 변경 확인",
      change: /mythos-preview.*retired|will be retired/.test(lower)
        ? "Claude Mythos Preview가 은퇴되고 Claude Mythos 5로 이전하라는 안내가 올라왔습니다."
        : excerpt || "Anthropic 문서와 뉴스에 Fable 5 및 Mythos 5 접근성·재배포 관련 변경이 올라왔습니다.",
      impact: "해당 모델을 직접 또는 Bedrock 경유로 쓰는 경우 지역·정책·안전장치에 따라 가용성이 달라질 수 있습니다.",
      action: "사용 중인 Claude 모델 ID와 공급 경로(API/Bedrock)를 대조하고 장애 시 대체 모델을 정해두세요."
    };
  }
  if (/gemini omni flash|nano banana 2 lite/.test(lower)) {
    return {
      title: "Gemini Omni Flash / Nano Banana 2 Lite 빌드 후보 추가",
      change: "Google Gemini에 빠른 멀티모달·이미지/비디오 생성 계열 모델 업데이트가 올라왔습니다.",
      impact: "이미지·영상 생성 워크플로의 비용, 속도, 대화형 편집 UX 후보가 늘어납니다.",
      action: "프로덕션 투입 전 preview 여부, quota, 워터마크/저작권 정책, 지역 제공 여부를 확인하세요."
    };
  }
  if (/computer use/.test(lower)) {
    return {
      title: "Gemini 3.5 Flash에 computer use 기능 공개",
      change: "Gemini 3.5 Flash 계열에서 화면을 보고 클릭·입력·탐색하는 UI 자동화 기능이 공개되었습니다.",
      impact: "브라우저 조작형 에이전트, QA 자동화, 내부 업무 자동화 후보가 늘어납니다. 기존 도구 호출 방식과 권한·감사 설계를 같이 봐야 합니다.",
      action: "Gemini API 또는 Vertex AI에서 사용할 계획이 있다면 지원 리전, 안전장치, 작업 실패 시 복구 전략을 확인하세요."
    };
  }
  if (/spark|macos|connected apps/.test(lower)) {
    return {
      title: "Gemini 앱/클라이언트 기능 업데이트",
      change: "Gemini Spark의 macOS 출시와 연결 앱 관련 업데이트가 올라왔습니다.",
      impact: "개발 API 변경이라기보다는 사용자용 Gemini 제품 경험 변화에 가깝습니다. 조직 내 Gemini 사용 가이드에 영향이 있을 수 있습니다.",
      action: "API 모델 변경과 분리해서 보고, 업무용 Gemini 앱을 쓰는 팀에만 공유하면 됩니다."
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
      title: `${vendorLabels[event.vendor] || event.vendor} 지원 종료/수명주기 업데이트`,
      change: models ? `지원 종료 또는 모델 수명주기 변경이 올라왔습니다. 관련 모델: ${models}.` : excerpt || "공식 문서에 지원 종료 또는 모델 수명주기 관련 변경이 올라왔습니다.",
      impact: "운영 중인 모델 호출, Bedrock/Vertex 경유 사용, alias 기반 호출이 있다면 예고 없이 비용·품질·가용성 리스크로 이어질 수 있습니다.",
      action: "현재 사용 중인 모델 ID와 alias를 대조하고, 대체 모델·마이그레이션 마감일·리전별 제공 여부를 확인하세요."
    };
  }
  if (/price|pricing|billing|cost/.test(lower) || event.kind === "pricing") {
    return {
      title: `${vendorLabels[event.vendor] || event.vendor} 가격/과금 변경`,
      change: excerpt || "공식 문서에 가격 또는 과금 방식 관련 변경이 올라왔습니다.",
      impact: "대량 호출, Batch, tool 사용, 장기 세션이 있는 워크로드는 월 비용 추정이 달라질 수 있습니다.",
      action: "최근 사용량 기준으로 비용 민감도가 큰 엔드포인트부터 재계산하고 예산 알림 기준을 조정하세요."
    };
  }
  if (/released|introduc|launch|generally available|preview|new model|start building/.test(lower) || event.kind === "release") {
    return {
      title: readableTitle,
      change: excerpt || "공식 출처에 신규 모델 또는 기능 출시 소식이 올라왔습니다.",
      impact: models ? `관련 모델(${models})을 평가 후보에 추가할 수 있습니다.` : "성능·비용·지연시간 개선 후보가 생겼지만, preview/experimental 여부를 확인해야 합니다.",
      action: "바로 교체하기보다 샘플 프롬프트, 비용, rate limit, 리전 제공 여부를 체크리스트로 비교하세요."
    };
  }
  return {
    title: readableTitle,
    change: excerpt || `${sourceLabels[event.sourceId] || event.sourceId}에 문서 업데이트가 올라왔습니다.`,
    impact: "현재 사용 중인 모델 또는 플랫폼과 직접 관련되는지 먼저 선별하면 됩니다.",
    action: "원문을 열어 API/모델 ID/마감일/리전 등 운영 영향 필드가 있는지 확인하세요."
  };
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
  if (event.kind === "news" && !/(gpt|claude|gemini|model|coding|benchmark|voice|realtime|sonnet|fable|mythos|omni|nano banana|computer use|api|codex)/i.test(`${event.title} ${event.summary}`)) return false;
  return true;
}

function briefingScore(event) {
  const source = event.sourceId || "";
  const text = `${event.title} ${event.summary}`.toLowerCase();
  let score = event.severity || 0;
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
  return value
    .replace(/\s+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b(Home|Documentation|Resources|Send feedback)\b/g, "")
    .trim();
}

function normalizeTitle(value = "") {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeSearch(value = "") {
  return value.toLowerCase().replace(/[\s._-]+/g, "");
}

function koreanizeTitle(event) {
  const title = event.title || "";
  const replacements = [
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
    [/Introducing/i, "공개"],
    [/Start building with/i, "빌드 시작:"]
  ];
  let value = title;
  for (const [pattern, replacement] of replacements) value = value.replace(pattern, replacement);
  if (value !== title) return value;
  if (event.kind === "deprecation") return `${vendorLabels[event.vendor] || event.vendor} 지원 종료 관련 공지`;
  if (event.kind === "release") return `${vendorLabels[event.vendor] || event.vendor} 신규 출시 공지`;
  if (event.kind === "pricing") return `${vendorLabels[event.vendor] || event.vendor} 가격 변경 공지`;
  return title;
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
    return "Amazon Bedrock 모델 수명주기 문서가 업데이트되었습니다. Bedrock 경유로 쓰는 모델의 활성·레거시·종료 상태를 확인하세요.";
  }
  if (event.sourceId === "bedrock-doc-history") {
    return "Amazon Bedrock 문서 변경 이력에 업데이트가 추가되었습니다. 새 모델, 리전, 기능 지원 여부를 확인할 만한 변경입니다.";
  }
  if (event.sourceId?.includes("deprecations")) {
    return `${vendor}의 ${source} 문서에 ${kind} 관련 업데이트가 올라왔습니다. 사용 중인 모델이나 API가 포함되는지 먼저 확인하세요.`;
  }
  if (event.kind === "release") {
    return `${vendor}의 ${source}에 신규 출시 소식이 올라왔습니다. 평가 후보로 볼 만한 모델이나 기능인지 확인하세요.`;
  }
  if (event.kind === "pricing") {
    return `${vendor}의 ${source}에 가격 또는 과금 관련 업데이트가 올라왔습니다. 사용량이 큰 워크로드의 비용 영향을 확인하세요.`;
  }
  if (event.kind === "breaking-change") {
    return `${vendor}의 ${source}에 호환성 영향을 줄 수 있는 변경이 올라왔습니다. 적용 일정과 기존 연동 영향을 확인하세요.`;
  }
  return `${vendor}의 ${source}에 ${kind} 관련 업데이트가 올라왔습니다. 현재 사용하는 모델·API와 관련이 있는지 확인하세요.`;
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
