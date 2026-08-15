export type PaneControl = "split-right" | "split-down" | "swap-right" | "swap-down" | "close";

export type PaneControlRequest = {
  method: "pane.split" | "pane.swap" | "pane.close";
  params: Record<string, unknown>;
};

/** Build protocol-19 requests without terminal keybindings or input injection. */
export function paneControlRequest(control: PaneControl, paneId: string): PaneControlRequest {
  switch (control) {
    case "split-right":
      return {
        method: "pane.split",
        params: { target_pane_id: paneId, direction: "right", focus: true },
      };
    case "split-down":
      return {
        method: "pane.split",
        params: { target_pane_id: paneId, direction: "down", focus: true },
      };
    case "swap-right":
      return { method: "pane.swap", params: { pane_id: paneId, direction: "right" } };
    case "swap-down":
      return { method: "pane.swap", params: { pane_id: paneId, direction: "down" } };
    case "close":
      return { method: "pane.close", params: { pane_id: paneId } };
  }
}
