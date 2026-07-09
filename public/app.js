const [events, state] = await Promise.all([
  fetch("./data/events.json").then((response) => response.json()),
  fetch("./data/state.json").then((response) => response.json())
]);

const ui = {
  events: document.querySelector("#events"),
  template: document.querySelector("#eventTemplate"),
  vendorFilters: document.querySelector("#vendorFilters"),
  kindFilter: document.querySelector("#kindFilter"),
  search: document.querySelector("#search"),
  resultCount: document.querySelector("#resultCount"),
  stats: document.querySelector("#stats"),
  health: document.querySelector("#health"),
  coverage: document.querySelector("#coverage")
};

const filters = { vendor: "", kind: "", search: "" };
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
  filters.search = event.target.value.toLowerCase();
  render();
});

const sourceStates = Object.values(state.sources || {});
const failures = sourceStates.filter((source) => !source.ok);
ui.health.textContent = failures.length
  ? `수집기 ${failures.length}개 확인 필요`
  : `마지막 수집 ${formatDateTime(state.lastRunAt)}`;
ui.health.classList.add(failures.length ? "bad" : "ok");

const deprecations = events.filter((event) => event.kind === "deprecation").length;
const watched = events.filter((event) => event.watched).length;
ui.stats.innerHTML = [
  [events.length, "누적 변경사항"],
  [deprecations, "지원 종료 신호"],
  [sourceStates.length, "공식 출처"],
  [watched, "Watchlist 관련"]
].map(([value, label]) => `<div class="stat"><strong>${value.toLocaleString("ko-KR")}</strong><span>${label}</span></div>`).join("");

renderCoverage();
render();

function render() {
  const matched = events.filter((event) => {
    const haystack = `${event.title} ${event.summary} ${event.titleKo || ""} ${event.summaryKo || ""} ${event.modelIds.join(" ")}`.toLowerCase();
    return (!filters.vendor || event.vendor === filters.vendor)
      && (!filters.kind || event.kind === filters.kind)
      && (!filters.search || haystack.includes(filters.search));
  });
  const visible = matched.slice(0, 200);
  ui.events.replaceChildren(...visible.map(card));
  ui.resultCount.textContent = `${matched.length.toLocaleString("ko-KR")}건 중 ${visible.length.toLocaleString("ko-KR")}건 표시`;
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
      <span class="date">${escapeHtml(event.publishedAt || formatDateTime(event.detectedAt))}</span>
      <a href="${escapeHtml(event.sourceUrl || "#")}" target="_blank" rel="noreferrer">원문 보기 ↗</a>
    </footer>
  `;
  return article;
}

function renderCoverage() {
  const byVendor = new Map();
  for (const event of events) {
    const item = byVendor.get(event.vendor) || {
      vendor: event.vendor,
      total: 0,
      deprecations: 0,
      releases: 0,
      sources: new Set()
    };
    item.total += 1;
    if (event.kind === "deprecation") item.deprecations += 1;
    if (event.kind === "release") item.releases += 1;
    item.sources.add(event.sourceId);
    byVendor.set(event.vendor, item);
  }

  ui.coverage.innerHTML = [...byVendor.values()]
    .sort((a, b) => b.total - a.total)
    .map((item) => {
      const sourceList = [...item.sources].map((id) => sourceLabels[id] || id).join(", ");
      return `
        <article class="coverage-card">
          <div class="coverage-top">
            <strong>${vendorLabels[item.vendor] || item.vendor}</strong>
            <span>${item.sources.size}개 출처</span>
          </div>
          <dl>
            <div><dt>전체</dt><dd>${item.total.toLocaleString("ko-KR")}</dd></div>
            <div><dt>지원 종료</dt><dd>${item.deprecations.toLocaleString("ko-KR")}</dd></div>
            <div><dt>출시</dt><dd>${item.releases.toLocaleString("ko-KR")}</dd></div>
          </dl>
          <p>${escapeHtml(sourceList)}</p>
        </article>
      `;
    }).join("");
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
  const source = sourceLabels[event.sourceId] || event.sourceId;
  const kind = labels[event.kind] || event.kind;
  const models = event.modelIds.length ? ` 관련 모델: ${event.modelIds.slice(0, 5).join(", ")}.` : "";
  const excerpt = event.summary ? ` 원문 요약: ${event.summary}` : "";
  return `${vendorLabels[event.vendor] || event.vendor}의 ${source}에서 ${kind} 항목이 감지되었습니다.${models}${excerpt}`.slice(0, 1000);
}

function formatDateTime(value) {
  return value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "기록 없음";
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
