import { describe, expect, it } from "vitest";

import { antigravityWindows, claudeTokenFrom, claudeWindows, codexWindows, grokWindows, QuotaError } from "./providers.js";
import { classify, humanReset, providerPools } from "./snapshot.js";
import { QuotaStore } from "./store.js";

const NOW = Date.parse("2026-09-28T00:00:00Z");
const inHours = (h: number) => new Date(NOW + h * 3600_000).toISOString();

describe("provider response parsing", () => {
  it("reads Claude session/weekly windows and the Fable pool from limits", () => {
    const windows = claudeWindows({
      five_hour: { utilization: 42, resets_at: inHours(2) },
      seven_day: { utilization: 70, resets_at: inHours(48) },
      limits: [{ kind: "weekly_scoped", percent: 12, resets_at: inHours(48), scope: { model: { display_name: "Fable" } } }],
    });
    expect(windows.map((w) => [w.name, w.used])).toEqual([
      ["session", 42],
      ["weekly", 70],
      ["fableWeekly", 12],
    ]);
  });

  it("rejects expired Claude credentials instead of reporting quota", () => {
    expect(() => claudeTokenFrom({ claudeAiOauth: { accessToken: "t", expiresAt: NOW - 1 } }, NOW)).toThrow(QuotaError);
    expect(claudeTokenFrom({ claudeAiOauth: { accessToken: "t", expiresAt: NOW + 1 } }, NOW)).toBe("t");
  });

  it("reads Codex primary/secondary windows and the Spark pool", () => {
    const windows = codexWindows({
      rate_limit: {
        primary_window: { used_percent: 95, limit_window_seconds: 604800, reset_at: NOW / 1000 + 3600 },
        secondary_window: { used_percent: 10, limit_window_seconds: 18000 },
      },
      additional_rate_limits: [
        { limit_name: "GPT-5.3-Codex-Spark", rate_limit: { primary_window: { used_percent: 13, limit_window_seconds: 604800 } } },
      ],
    });
    expect(windows.map((w) => [w.name, w.used])).toEqual([
      ["weekly", 95],
      ["session", 10],
      ["sparkWeekly", 13],
    ]);
    expect(windows[0].resetsAt).toBe(new Date(NOW + 3600_000).toISOString());
  });

  it("maps Antigravity buckets and skips unknown ones", () => {
    const windows = antigravityWindows({
      groups: [{ buckets: [
        { bucketId: "gemini-5h", remainingFraction: 0.75, resetTime: inHours(1) },
        { bucketId: "3p-weekly", remainingFraction: 0.2 },
        { bucketId: "mystery", remainingFraction: 0.5 },
      ] }],
    });
    expect(windows.map((w) => [w.name, Math.round(w.used)])).toEqual([
      ["geminiSession", 25],
      ["nonGeminiWeekly", 80],
    ]);
  });

  it("reads Grok's weekly credit period", () => {
    expect(grokWindows({ config: { creditUsagePercent: 33, currentPeriod: { type: "PERIOD_WEEKLY", end: inHours(24) } } })).toEqual([
      { name: "weekly", used: 33, resetsAt: inHours(24), windowSeconds: 604800 },
    ]);
    expect(grokWindows({ config: { currentPeriod: { type: "PERIOD_WEEKLY" } } })[0].used).toBe(0);
  });
});

describe("pool numbers", () => {
  it("shows each pool's binding window and keeps pools independent", () => {
    const pools = providerPools("codex", [
      { name: "weekly", used: 95, resetsAt: inHours(1), windowSeconds: 604800 },
      { name: "session", used: 10, resetsAt: inHours(1), windowSeconds: 18000 },
      { name: "sparkWeekly", used: 13, resetsAt: inHours(100), windowSeconds: 604800 },
    ], NOW);
    expect(pools.default).toMatchObject({ remaining: 5, available: false, classification: "exhausted", resetsIn: "1h00m" });
    expect(pools.spark).toMatchObject({ remaining: 87, available: true });
    // "all" shows the healthiest pool, not the most-spent window.
    expect(pools.all.remaining).toBe(87);
  });

  it("classifies burn against elapsed window time", () => {
    // Half the week gone, 20% used -> underspent; 90% used -> overpace.
    const half = { resetsAt: inHours(84), windowSeconds: 604800 };
    expect(classify({ name: "w", used: 20, ...half }, NOW)).toBe("underspent");
    expect(classify({ name: "w", used: 50, ...half }, NOW)).toBe("onpace");
    expect(classify({ name: "w", used: 90, ...half }, NOW)).toBe("overpace");
    expect(classify({ name: "w", used: 50 }, NOW)).toBe("untracked");
  });

  it("formats reset times like herdr-quota", () => {
    expect(humanReset(inHours(0.5), NOW)).toBe("30m");
    expect(humanReset(inHours(26), NOW)).toBe("1d2h");
    expect(humanReset(undefined, NOW)).toBe("?");
  });
});

describe("QuotaStore", () => {
  it("backs off a provider that rate-limits instead of hammering it", async () => {
    let calls = 0;
    let clock = NOW;
    const store = new QuotaStore({ claude: async () => { calls += 1; throw new QuotaError("claude usage: rate limited"); } }, () => clock);
    await store.refresh();
    clock += 120_000;
    await store.refresh();
    expect(calls).toBe(1);
    clock += 600_000;
    await store.refresh();
    expect(calls).toBe(2);
  });

  it("keeps a provider's last numbers, marked stale, when a later poll fails", async () => {
    let fail = false;
    let clock = NOW;
    const store = new QuotaStore(
      {
        grok: async () => {
          if (fail) throw new QuotaError("grok: rate limited");
          return [{ name: "weekly", used: 40 }];
        },
        codex: async () => {
          throw new QuotaError("codex: run codex login");
        },
      },
      () => clock,
    );
    await store.refresh();
    expect(store.state.status).toBe("ready");
    fail = true;
    clock += 60_000;
    await store.refresh(true);
    const snapshot = store.state.status === "ready" ? store.state.snapshot : undefined;
    expect(snapshot?.providers.grok).toMatchObject({ stale: true, error: "grok: rate limited" });
    expect(snapshot?.providers.grok.pools.default).toMatchObject({ remaining: 60, stale: true });
    expect(snapshot?.providers.codex).toMatchObject({ error: "codex: run codex login", pools: {} });
  });

  it("reports an error only when no provider has ever answered", async () => {
    const store = new QuotaStore({ grok: async () => { throw new QuotaError("grok: no login; run grok login"); } }, () => NOW);
    await store.refresh();
    expect(store.state).toEqual({ status: "error", message: "grok: no login; run grok login" });
  });

  it("debounces forced refreshes from rapid key presses", async () => {
    let calls = 0;
    let clock = NOW;
    const store = new QuotaStore({ grok: async () => { calls += 1; return [{ name: "weekly", used: 1 }]; } }, () => clock);
    await store.refresh(true);
    clock += 5_000;
    await store.refresh(true);
    expect(calls).toBe(1);
    clock += 20_000;
    await store.refresh(true);
    expect(calls).toBe(2);
  });
});
