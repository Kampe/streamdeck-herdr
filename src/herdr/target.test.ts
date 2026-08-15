import { describe, expect, it } from "vitest";

import { resolveAgent, resolveTarget, sortAgents } from "./target.js";
import type { AgentInfo, SessionSnapshot } from "./types.js";

function agent(overrides: Partial<AgentInfo> & Pick<AgentInfo, "paneId" | "workspaceId">): AgentInfo {
  return {
    tabId: `${overrides.workspaceId}:t1`,
    agent: "claude",
    sessionId: null,
    status: "idle",
    title: "",
    cwd: "",
    focused: false,
    ...overrides,
  };
}

/** ワークスペース番号 1 の wA に 2 ペイン、番号 2 の wB に 1 ペイン。 */
function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    agents: [
      agent({ paneId: "wB:p1", workspaceId: "wB", sessionId: "uuid-b" }),
      agent({ paneId: "wA:p3", workspaceId: "wA", sessionId: "uuid-a3" }),
      agent({ paneId: "wA:p1", workspaceId: "wA", sessionId: "uuid-a1", focused: true }),
    ],
    workspaces: [
      { workspaceId: "wA", label: "alpha", number: 1 },
      { workspaceId: "wB", label: "bravo", number: 2 },
    ],
    focusedPaneId: "wA:p1",
    ...overrides,
  };
}

describe("sortAgents", () => {
  it("uses priority ordering with Herdr pane order as tie-breaker", () => {
    expect(sortAgents(snapshot()).map((item) => item.paneId)).toEqual([
      "wB:p1",
      "wA:p3",
      "wA:p1",
    ]);
  });

  it("surfaces attention states before working and idle agents", () => {
    const prioritized = snapshot({
      agents: [
        agent({ paneId: "wA:p1", workspaceId: "wA", status: "idle" }),
        agent({ paneId: "wA:p2", workspaceId: "wA", status: "working" }),
        agent({ paneId: "wB:p1", workspaceId: "wB", status: "done" }),
        agent({ paneId: "wB:p2", workspaceId: "wB", status: "blocked" }),
        agent({ paneId: "wA:p3", workspaceId: "wA", status: "unknown" }),
      ],
    });

    expect(sortAgents(prioritized).map((item) => item.status)).toEqual(["blocked", "done", "unknown", "working", "idle"]);
  });

  it("uses the full Herdr pane order instead of agent numbering", () => {
    const visualOrder = snapshot({
      paneOrder: ["wA:p1", "wB:p1", "wA:p3"],
    });
    expect(sortAgents(visualOrder).map((item) => item.paneId)).toEqual([
      "wA:p1",
      "wB:p1",
      "wA:p3",
    ]);
  });

  it("keeps Herdr order even when workspace metadata is absent", () => {
    const withOrphan = snapshot({
      agents: [
        agent({ paneId: "wZ:p1", workspaceId: "wZ" }),
        agent({ paneId: "wA:p1", workspaceId: "wA" }),
      ],
    });

    expect(sortAgents(withOrphan).map((item) => item.paneId)).toEqual(["wZ:p1", "wA:p1"]);
  });

  it("入力のエージェント配列を書き換えない", () => {
    const original = snapshot();
    const before = original.agents.map((item) => item.paneId);

    sortAgents(original);

    expect(original.agents.map((item) => item.paneId)).toEqual(before);
  });
});

describe("resolveAgent の focused", () => {
  it("フォーカス中のペインがエージェントならそれを返す", () => {
    expect(resolveAgent({ binding: "focused" }, snapshot(), "focused")?.paneId).toBe("wA:p1");
  });

  it("フォーカス中のペインがエージェントでなければ null", () => {
    const shellFocused = snapshot({ focusedPaneId: "wA:p9" });

    expect(resolveAgent({ binding: "focused" }, shellFocused, "focused")).toBeNull();
  });
});

describe("resolveAgent の index", () => {
  it("1 始まりで並び順の N 番目を返す", () => {
    expect(resolveAgent({ binding: "index", index: 2 }, snapshot(), "index")?.paneId).toBe("wA:p3");
  });

  it("index 未設定なら 1 番目を返す", () => {
    expect(resolveAgent({ binding: "index" }, snapshot(), "index")?.paneId).toBe("wB:p1");
  });

  it("範囲外なら null", () => {
    expect(resolveAgent({ binding: "index", index: 4 }, snapshot(), "index")).toBeNull();
    expect(resolveAgent({ binding: "index", index: 0 }, snapshot(), "index")).toBeNull();
  });
});

describe("resolveAgent の session", () => {
  it("セッション UUID から現在の pane_id を引く", () => {
    expect(resolveAgent({ binding: "session", sessionId: "uuid-b" }, snapshot(), "focused")?.paneId).toBe(
      "wB:p1",
    );
  });

  it("該当するセッションが無ければ null", () => {
    expect(resolveAgent({ binding: "session", sessionId: "uuid-x" }, snapshot(), "focused")).toBeNull();
  });

  it("セッション未設定なら null", () => {
    expect(resolveAgent({ binding: "session" }, snapshot(), "focused")).toBeNull();
    expect(resolveAgent({ binding: "session", sessionId: "" }, snapshot(), "focused")).toBeNull();
  });
});

describe("resolveTarget", () => {
  it("binding 未設定なら渡された既定を使う", () => {
    expect(resolveTarget({}, snapshot(), "focused")).toBe("wA:p1");
    expect(resolveTarget({ index: 3 }, snapshot(), "index")).toBe("wA:p1");
  });

  it("オフライン（スナップショットが null）なら常に null", () => {
    expect(resolveTarget({ binding: "index", index: 1 }, null, "index")).toBeNull();
    expect(resolveTarget({ binding: "focused" }, null, "focused")).toBeNull();
  });
});
