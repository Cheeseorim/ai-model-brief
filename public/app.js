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
  health: document.querySelector("#health")
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

const vendors = [...new Set(events.map((event) => event.vendor))].sort();
for (const [value, label] of [["", "전체"], ...vendors.map((vendor) => [vendor, vendor.toUpperCase()])]) {
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
].map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");

function render() {
  const visible = events.filter((event) => {
    const haystack = `${event.title} ${event.summary} ${event.modelIds.join(" ")}`.toLowerCase();
    return (!filters.vendor || event.vendor === filters.vendor)
      && (!filters.kind || event.kind === filters.kind)
      && (!filters.search || haystack.includes(filters.search));
  }).slice(0, 200);
  ui.events.replaceChildren(...visible.map(card));
  ui.resultCount.textContent = `${visible.length}건`;
}

function card(event) {
  const fragment = ui.template.content.cloneNode(true);
  const article = fragment.querySelector("article");
  article.classList.add(event.kind);
  fragment.querySelector(".vendor").textContent = `${event.vendor} · ${event.platform}`;
  fragment.querySelector(".kind").textContent = labels[event.kind] || event.kind;
  fragment.querySelector("h3").textContent = event.title;
  fragment.querySelector(".summary").textContent = event.summary || "공식 문서에서 새로운 변경사항이 감지되었습니다.";
  fragment.querySelector(".models").innerHTML = event.modelIds.slice(0, 8)
    .map((model) => `<span class="model">${escapeHtml(model)}</span>`).join("");
  fragment.querySelector(".date").textContent = event.publishedAt || formatDateTime(event.detectedAt);
  fragment.querySelector("a").href = event.sourceUrl;
  return fragment;
}

function formatDateTime(value) {
  return value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "기록 없음";
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

render();
