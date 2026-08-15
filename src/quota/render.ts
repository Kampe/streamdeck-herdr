import type { QuotaInfo, QuotaState } from "./store.js";
import { agentGlyph, GLYPH_BOX } from "../render/agent-glyph.js";

const SIZE = 144;

export function renderQuotaKey(state: QuotaState, provider: string, pool: string, display: "remaining" | "used" = "remaining"): string {
  const quota = state.status === "ready" ? state.snapshot.providers[provider]?.pools[pool] : undefined;
  const view = quotaView(state, quota, display);
  const poolLabel = pool === "all" || pool === "default" ? "" : pool.toUpperCase();
  const iconSize = 34;
  const iconScale = iconSize / GLYPH_BOX;
  const iconX = SIZE / 2 - iconSize / 2;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    `<title>${escapeXml(provider)} quota</title>`,
    `<rect width="${SIZE}" height="${SIZE}" rx="18" fill="${view.background}"/>`,
    `<g transform="translate(${iconX} 11) scale(${iconScale})">${providerGlyph(provider, view.foreground)}</g>`,
    `<text x="72" y="91" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="40" font-weight="700" fill="${view.foreground}">${view.value}</text>`,
    `<text x="72" y="121" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="16" font-weight="600" fill="${view.foreground}" fill-opacity="0.85">${escapeXml(poolLabel || view.reset)}</text>`,
    poolLabel === "" ? "" : `<text x="72" y="137" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="13" fill="${view.foreground}" fill-opacity="0.7">${escapeXml(view.reset)}</text>`,
    "</svg>",
  ].join("");
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function providerGlyph(provider: string, color: string): string {
  if (provider === "antigravity") {
    return agentGlyph("gemini", color);
  }
  if (provider === "grok") {
    // Grok's diagonal mark, normalized from its 34x33 artwork into our 24x24 icon box.
    return `<g transform="scale(0.705882)"><path d="M13.2371 21.0407L24.3186 12.8506C24.8619 12.4491 25.6384 12.6057 25.8973 13.2294C27.2597 16.5185 26.651 20.4712 23.9403 23.1851C21.2297 25.8989 17.4581 26.4941 14.0108 25.1386L10.2449 26.8843C15.6463 30.5806 22.2053 29.6665 26.304 25.5601C29.5551 22.3051 30.562 17.8683 29.6205 13.8673L29.629 13.8758C28.2637 7.99809 29.9647 5.64871 33.449 0.844576L29.1113 5.09055L13.2343 21.0436" fill="${color}"/><path d="M10.9503 23.0313C7.07343 19.3235 7.74185 13.5853 11.0498 10.2763C13.4959 7.82722 17.5036 6.82767 21.0021 8.2971L24.7595 6.55998C24.0826 6.07017 23.215 5.54334 22.2195 5.17313C17.7198 3.31926 12.3326 4.24192 8.67479 7.90126C5.15635 11.4239 4.0499 16.8403 5.94992 21.4622C7.36924 24.9165 5.04257 27.3598 2.69884 29.826C1.86829 30.7002 1.0349 31.5745 0.36364 32.5L10.9474 23.0341" fill="${color}"/></g>`;
  }
  return agentGlyph(provider, color);
}

function quotaView(
  state: QuotaState,
  quota: QuotaInfo | undefined,
  display: "remaining" | "used",
): { background: string; foreground: string; value: string; reset: string } {
  if (state.status === "loading") {
    return { background: "#243047", foreground: "#ffffff", value: "…", reset: "loading" };
  }
  if (state.status === "error" || quota === undefined || quota.remaining === null) {
    return { background: "#4a2530", foreground: "#ffffff", value: "!", reset: "unavailable" };
  }
  const value = display === "used" ? 100 - quota.remaining : quota.remaining;
  if (quota.stale) {
    return { background: "#3a3f47", foreground: "#ffffff", value: `${Math.round(value)}%`, reset: "stale" };
  }
  const background = quota.remaining <= 20 ? "#a61e2d" : quota.remaining <= 50 ? "#d97706" : "#147d64";
  return {
    background,
    foreground: "#ffffff",
    value: `${Math.round(value)}%`,
    reset: quota.resetsIn,
  };
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
