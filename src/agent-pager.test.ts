import { describe, expect, it, vi } from "vitest";

import { AgentPager } from "./agent-pager.js";
import type { SessionSnapshot } from "./herdr/types.js";

const snapshot: SessionSnapshot = {
  focusedPaneId: "w1:p1",
  workspaces: [
    { workspaceId: "w1", label: "one", number: 1 },
    { workspaceId: "w2", label: "two", number: 2 },
  ],
  agents: [
    { paneId: "w1:p1", workspaceId: "w1", tabId: "w1:t1", agent: "codex", sessionId: "a", status: "idle", title: "", cwd: "", focused: true },
    { paneId: "w1:p2", workspaceId: "w1", tabId: "w1:t2", agent: "claude", sessionId: "b", status: "blocked", title: "", cwd: "", focused: false },
    { paneId: "w2:p1", workspaceId: "w2", tabId: "w2:t1", agent: "grok", sessionId: "c", status: "working", title: "", cwd: "", focused: false },
  ],
};

describe("AgentPager", () => {
  it("maps page-local slots to one-based absolute agent indexes", () => {
    const pager = new AgentPager(8);
    expect(pager.absoluteIndex(1)).toBe(1);
    pager.next(22);
    expect(pager.absoluteIndex(1)).toBe(9);
    expect(pager.absoluteIndex(8)).toBe(16);
  });

  it("wraps in both directions", () => {
    const pager = new AgentPager(8);
    pager.previous(22);
    expect(pager.page).toBe(2);
    pager.next(22);
    expect(pager.page).toBe(0);
  });

  it("clamps when the agent count shrinks", () => {
    const pager = new AgentPager(8);
    pager.previous(22);
    pager.clamp(9);
    expect(pager.page).toBe(1);
  });

  it("shows the page containing a focused absolute agent", () => {
    const pager = new AgentPager(8);
    pager.showAbsoluteIndex(17, 22);
    expect(pager.page).toBe(2);
    pager.showAbsoluteIndex(8, 22);
    expect(pager.page).toBe(0);
  });

  it("ignores invalid focused indexes", () => {
    const pager = new AgentPager(8);
    pager.next(22);
    pager.showAbsoluteIndex(0, 22);
    pager.showAbsoluteIndex(23, 22);
    expect(pager.page).toBe(1);
  });

  it("notifies subscribers only when the page changes", () => {
    const pager = new AgentPager(8);
    const listener = vi.fn();
    const unsubscribe = pager.subscribe(listener);
    pager.clamp(1);
    pager.next(9);
    unsubscribe();
    pager.next(17);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("filters attention, idle, favorites, and workspace views", () => {
    const pager = new AgentPager();
    pager.setView({ mode: "attention" });
    expect(pager.visibleAgents(snapshot).map((agent) => agent.sessionId)).toEqual(["b"]);
    pager.setView({ mode: "idle" });
    expect(pager.visibleAgents(snapshot).map((agent) => agent.sessionId)).toEqual(["a"]);
    pager.setView({ mode: "favorites" });
    expect(pager.visibleAgents(snapshot, new Set(["c"])).map((agent) => agent.sessionId)).toEqual(["c"]);
    pager.setView({ mode: "workspace", workspaceId: "w1" });
    expect(pager.visibleAgents(snapshot).map((agent) => agent.sessionId)).toEqual(["a", "b"]);
  });
});
