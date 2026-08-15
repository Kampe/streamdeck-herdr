import { describe, expect, it, vi } from "vitest";

import { AgentPager } from "./agent-pager.js";

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
});
