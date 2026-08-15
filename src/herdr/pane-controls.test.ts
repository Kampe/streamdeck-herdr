import { describe, expect, it } from "vitest";

import { paneControlRequest } from "./pane-controls.js";

describe("paneControlRequest", () => {
  it("targets a right split and focuses the new pane", () => {
    expect(paneControlRequest("split-right", "w2:p5")).toEqual({
      method: "pane.split",
      params: { target_pane_id: "w2:p5", direction: "right", focus: true },
    });
  });

  it("targets a downward swap from the focused pane", () => {
    expect(paneControlRequest("swap-down", "w2:p5")).toEqual({
      method: "pane.swap",
      params: { pane_id: "w2:p5", direction: "down" },
    });
  });

  it("closes only the exact pane", () => {
    expect(paneControlRequest("close", "w2:p5")).toEqual({
      method: "pane.close",
      params: { pane_id: "w2:p5" },
    });
  });
});
