import type { QuotaInfo, QuotaState } from "./store.js";

const SIZE = 144;

const PROVIDER_LABELS: Record<string, string> = {
  antigravity: "AGY",
  claude: "CLAUDE",
  codex: "CODEX",
  grok: "GROK",
};

export function renderQuotaKey(state: QuotaState, provider: string, pool: string): string {
  const quota = state.status === "ready" ? state.snapshot.providers[provider]?.pools[pool] : undefined;
  const label = PROVIDER_LABELS[provider] ?? provider.toUpperCase().slice(0, 8);
  const view = quotaView(state, quota);
  const poolLabel = pool === "all" || pool === "default" ? "" : pool.toUpperCase();
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    `<rect width="${SIZE}" height="${SIZE}" rx="18" fill="${view.background}"/>`,
    `<text x="72" y="27" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="20" font-weight="700" fill="${view.foreground}">${escapeXml(label)}</text>`,
    `<text x="72" y="82" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="42" font-weight="700" fill="${view.foreground}">${view.value}</text>`,
    `<text x="72" y="112" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="17" font-weight="600" fill="${view.foreground}" fill-opacity="0.85">${escapeXml(poolLabel || view.reset)}</text>`,
    poolLabel === "" ? "" : `<text x="72" y="133" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="15" fill="${view.foreground}" fill-opacity="0.7">${escapeXml(view.reset)}</text>`,
    "</svg>",
  ].join("");
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function quotaView(
  state: QuotaState,
  quota: QuotaInfo | undefined,
): { background: string; foreground: string; value: string; reset: string } {
  if (state.status === "loading") {
    return { background: "#243047", foreground: "#ffffff", value: "…", reset: "loading" };
  }
  if (state.status === "error" || quota === undefined || quota.remaining === null) {
    return { background: "#4a2530", foreground: "#ffffff", value: "!", reset: "unavailable" };
  }
  if (quota.stale) {
    return { background: "#3a3f47", foreground: "#ffffff", value: `${quota.remaining}%`, reset: "stale" };
  }
  const background = quota.remaining <= 20 ? "#a61e2d" : quota.remaining <= 50 ? "#d97706" : "#147d64";
  return {
    background,
    foreground: "#ffffff",
    value: `${Math.round(quota.remaining)}%`,
    reset: quota.resetsIn,
  };
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
