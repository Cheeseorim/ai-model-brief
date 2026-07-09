const COLORS = {
  deprecation: 0xe5484d,
  "breaking-change": 0xf5a524,
  pricing: 0x8e4ec6,
  release: 0x30a46c,
  changelog: 0x3e63dd,
  news: 0x8b8d98
};

export async function notifyDiscord(events, webhookUrl) {
  if (!webhookUrl || events.length === 0) return;
  const important = events.filter((event) => event.severity >= 55).slice(0, 10);
  if (important.length === 0) return;

  const embeds = important.map((event) => ({
    title: `[${event.vendor.toUpperCase()}] ${event.title}`.slice(0, 256),
    url: event.sourceUrl,
    description: event.summary.slice(0, 900) || "새 변경사항이 감지되었습니다.",
    color: COLORS[event.kind] || 0x8b8d98,
    fields: [
      { name: "유형", value: event.kind, inline: true },
      { name: "플랫폼", value: event.platform, inline: true },
      ...(event.modelIds.length
        ? [{ name: "모델", value: event.modelIds.slice(0, 8).join("\n").slice(0, 1000) }]
        : [])
    ],
    timestamp: event.detectedAt
  }));

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "Model Radar",
      content: `오늘 ${events.length}건의 새 변경사항을 감지했습니다.`,
      embeds
    })
  });
  if (!response.ok) throw new Error(`Discord webhook failed: ${response.status}`);
}
