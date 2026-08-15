import { describe, expect, it } from "vitest";

import { providerStandingOrder } from "./provider-prompt.js";

describe("providerStandingOrder", () => {
  it("gives a focused agent a strict provider-only dispatch order", () => {
    const prompt = providerStandingOrder("grok");
    expect(prompt).toContain("Continue with the task.");
    expect(prompt).toContain("spawn and delegate only to Grok agents");
    expect(prompt).toContain("burn that provider's available quota");
    expect(prompt).toContain("Do not switch to another provider");
  });

  it("uses the user-facing agy name for Antigravity", () => {
    expect(providerStandingOrder("antigravity")).toContain("Antigravity (agy) agents");
  });
});
