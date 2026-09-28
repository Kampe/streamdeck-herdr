import type { Window } from "./providers.js";

export type QuotaInfo = {
  available: boolean;
  reason: string;
  stale: boolean;
  remaining: number | null;
  resetsIn: string;
  classification: string;
};

export type ProviderQuota = { stale: boolean; error?: string; pools: Record<string, QuotaInfo> };

export type QuotaSnapshot = {
  generatedAt: string;
  providers: Record<string, ProviderQuota>;
};

/** A window at or above this percent used counts as exhausted. */
export const EXHAUSTED_AT = 95;

/**
 * Which windows make up each pool a quota key can show. A pool's number is its
 * binding (most-used) window; "all" is the pool with the most remaining.
 */
const POOLS: Record<string, Record<string, string[]>> = {
  claude: { default: ["session", "weekly"], fable: ["fableWeekly"] },
  codex: { default: ["session", "weekly"], spark: ["sparkSession", "sparkWeekly"] },
  antigravity: {
    default: ["geminiSession", "geminiWeekly"],
    gemini: ["geminiSession", "geminiWeekly"],
    nonGemini: ["nonGeminiSession", "nonGeminiWeekly"],
  },
  grok: { default: ["weekly"] },
};

const CLASS_RANK: Record<string, number> = { underspent: 0, untracked: 1, onpace: 2, overpace: 3, exhausted: 4 };

export function humanReset(resetsAt: string | undefined, now = Date.now()): string {
  if (resetsAt === undefined) {
    return "?";
  }
  const at = Date.parse(resetsAt);
  if (Number.isNaN(at)) {
    return "?";
  }
  const seconds = Math.max(0, Math.floor((at - now) / 1000));
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
  }
  return `${Math.floor(seconds / 86400)}d${Math.floor((seconds % 86400) / 3600)}h`;
}

/** Burn rate against the window's elapsed time, as herdr-quota classifies it. */
export function classify(window: Window, now = Date.now()): string {
  if (window.used >= EXHAUSTED_AT) {
    return "exhausted";
  }
  if (window.resetsAt === undefined || window.windowSeconds === undefined || window.windowSeconds <= 0) {
    return "untracked";
  }
  const left = (Date.parse(window.resetsAt) - now) / 1000;
  if (Number.isNaN(left)) {
    return "untracked";
  }
  const elapsedPercent = Math.max(((window.windowSeconds - Math.max(left, 0)) / window.windowSeconds) * 100, 4);
  const pace = (window.used * 100) / elapsedPercent;
  return pace < 60 ? "underspent" : pace <= 150 ? "onpace" : "overpace";
}

export function poolInfo(windows: Window[], now = Date.now()): QuotaInfo | undefined {
  if (windows.length === 0) {
    return undefined;
  }
  const binding = windows.reduce((a, b) => (b.used > a.used ? b : a));
  const worst = windows
    .map((w) => classify(w, now))
    .reduce((a, b) => (CLASS_RANK[b] > CLASS_RANK[a] ? b : a));
  const used = Math.min(Math.max(binding.used, 0), 100);
  return {
    available: used < EXHAUSTED_AT,
    reason: used < EXHAUSTED_AT ? "ok" : "exhausted",
    stale: false,
    remaining: 100 - used,
    resetsIn: humanReset(binding.resetsAt, now),
    classification: worst,
  };
}

export function providerPools(provider: string, windows: Window[], now = Date.now()): Record<string, QuotaInfo> {
  const pools: Record<string, QuotaInfo> = {};
  const byName = new Map(windows.map((w) => [w.name, w]));
  for (const [pool, names] of Object.entries(POOLS[provider] ?? { default: windows.map((w) => w.name) })) {
    const info = poolInfo(names.map((n) => byName.get(n)).filter((w): w is Window => w !== undefined), now);
    if (info !== undefined) {
      pools[pool] = info;
    }
  }
  // "all" is the pool with the most usable quota left: an exhausted Spark,
  // Fable or non-Gemini pool must not force the whole provider key to 0%.
  const best = Object.values(pools).reduce<QuotaInfo | undefined>(
    (a, b) => (a === undefined || (b.remaining ?? -1) > (a.remaining ?? -1) ? b : a),
    undefined,
  );
  if (best !== undefined) {
    pools.all = best;
  }
  return pools;
}

/** Mark a previous provider result stale, keeping its numbers visible. */
export function staleCopy(previous: ProviderQuota, error: string): ProviderQuota {
  const pools: Record<string, QuotaInfo> = {};
  for (const [name, info] of Object.entries(previous.pools)) {
    pools[name] = { ...info, stale: true };
  }
  return { stale: true, error, pools };
}
