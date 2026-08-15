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
});
