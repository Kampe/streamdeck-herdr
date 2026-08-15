import { describe, expect, it, vi } from "vitest";

import { bringITermToFront } from "./foreground.js";

describe("bringITermToFront", () => {
  it("activates iTerm2 through osascript", async () => {
    const run = vi.fn(async () => undefined);
    const result = await bringITermToFront(run);

    if (process.platform === "darwin") {
      expect(result).toBe(true);
      expect(run).toHaveBeenCalledWith([
        "-e",
        'tell application "iTerm2" to activate',
      ]);
    } else {
      expect(result).toBe(false);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("does not fail the action when activation is unavailable", async () => {
    const run = vi.fn(async () => {
      throw new Error("not authorized");
    });
    const result = await bringITermToFront(run);

    expect(result).toBe(false);
  });
});

