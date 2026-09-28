import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import { renderQuotaKey } from "./render.js";
import type { QuotaState } from "./store.js";

const ready: QuotaState = {
  status: "ready",
  snapshot: {
    generatedAt: "now",
    providers: {
      grok: {
        stale: false,
        pools: {
          all: {
            available: true,
            reason: "available",
            stale: false,
            remaining: 73,
            resetsIn: "2d4h",
            classification: "current",
          },
        },
      },
    },
  },
};

function decode(uri: string): string {
  return Buffer.from(uri.split(",", 2)[1] ?? "", "base64").toString("utf8");
}

describe("renderQuotaKey", () => {
  it("renders provider artwork, remaining quota, and reset time", () => {
    const svg = decode(renderQuotaKey(ready, "grok", "all"));
    expect(svg).toContain("<title>grok quota</title>");
    expect(svg).toContain("73%");
    expect(svg).toContain("2d4h");
    expect(svg).toContain("<path");
    expect(svg).not.toContain(">GROK<");
  });

  it("renders consumed percentage when requested", () => {
    const svg = decode(renderQuotaKey(ready, "grok", "all", "used"));
    expect(svg).toContain("27%");
    expect(svg).not.toContain("73%");
  });
});

describe("unavailableReason", () => {
  it("turns provider errors into a short key label", async () => {
    const { unavailableReason } = await import("./render.js");
    expect(unavailableReason("claude usage: rate limited")).toBe("limited");
    expect(unavailableReason("codex: no ChatGPT login (an API key cannot read plan quota); run codex login")).toBe("log in");
    expect(unavailableReason("antigravity quota: login expired (401)")).toBe("log in");
    expect(unavailableReason("antigravity: language server is not running (open agy)")).toBe("offline");
    expect(unavailableReason(undefined)).toBe("unavailable");
  });
});
