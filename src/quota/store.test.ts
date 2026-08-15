import { describe, expect, it } from "vitest";

import { parseQuotaSnapshot } from "./store.js";

describe("parseQuotaSnapshot", () => {
  it("extracts display-safe provider pool state", () => {
    expect(
      parseQuotaSnapshot({
        generatedAt: "2026-08-14T20:00:00-05:00",
        providers: {
          codex: {
            stale: false,
            pools: {
              default: {
                available: true,
                reason: "ok",
                stale: false,
                remaining: 42,
                resetsIn: "2d3h",
                class: "onpace",
                windows: [{ resource: "weekly", used: 58 }],
              },
            },
          },
        },
      }),
    ).toEqual({
      generatedAt: "2026-08-14T20:00:00-05:00",
      providers: {
        codex: {
          stale: false,
          pools: {
            default: {
              available: true,
              reason: "ok",
              stale: false,
              remaining: 42,
              resetsIn: "2d3h",
              classification: "onpace",
            },
          },
        },
      },
    });
  });

  it("rejects documents without providers", () => {
    expect(parseQuotaSnapshot({ generatedAt: "now" })).toBeNull();
  });
});
