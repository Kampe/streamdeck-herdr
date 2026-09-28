import { describe, expect, it, vi } from "vitest";

import { bringITermToFront } from "./foreground.js";

describe("bringITermToFront", () => {
  it("activates iTerm2 through osascript", async () => {
    const run = vi.fn(async (_args: readonly string[]) => undefined);
    const wake = vi.fn(async () => undefined);
    const result = await bringITermToFront(run, wake, async () => false);

    if (process.platform === "darwin") {
      expect(result).toBe(true);
      expect(run).toHaveBeenCalledWith([
        "-e",
        expect.stringContaining('tell application "iTerm2"'),
      ]);
      expect(wake).toHaveBeenCalledOnce();
      const script = run.mock.calls[0]?.[0]?.join("\n") ?? "";
      expect(script).toContain("sessionName contains \"herdr\"");
      expect(script).toContain("sessionName contains \"tmux\"");
      // No screensaver is running, so no unlock keystroke is injected.
      expect(run).toHaveBeenCalledTimes(1);
    } else {
      expect(result).toBe(false);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("dismisses the tmux screensaver only when it is running", async () => {
    const run = vi.fn(async (_args: readonly string[]) => undefined);
    await bringITermToFront(run, async () => undefined, async () => true);
    if (process.platform === "darwin") {
      expect(run).toHaveBeenCalledTimes(2);
      expect(run.mock.calls[1]?.[0]?.join(" ")).toContain("key code 49");
    }
  });

  it("does not fail the action when activation is unavailable", async () => {
    const run = vi.fn(async (_args: readonly string[]) => {
      throw new Error("not authorized");
    });
    const result = await bringITermToFront(run, async () => undefined);

    expect(result).toBe(false);
  });
});
