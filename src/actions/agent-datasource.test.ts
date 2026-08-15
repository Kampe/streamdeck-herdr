import { describe, expect, it } from "vitest";

import { agentDataSourceItems, isAgentDataSourceRequest } from "./agent-datasource.js";
import type { AgentInfo, SessionSnapshot } from "../herdr/types.js";

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

const snapshot: SessionSnapshot = {
  agents: [
    agent({ paneId: "wB:p1", workspaceId: "wB", sessionId: "uuid-b", agent: "codex" }),
    agent({ paneId: "wA:p1", workspaceId: "wA", sessionId: "uuid-a" }),
    agent({ paneId: "wA:p2", workspaceId: "wA", sessionId: null }),
  ],
  workspaces: [
    { workspaceId: "wA", label: "alpha", number: 1 },
    { workspaceId: "wB", label: "bravo", number: 2 },
  ],
  focusedPaneId: null,
};

describe("agentDataSourceItems", () => {
  it("表示順にワークスペース名とエージェント種別を並べる", () => {
    expect(agentDataSourceItems(snapshot)).toEqual([
      { label: "bravo · codex", value: "uuid-b" },
      { label: "alpha · claude", value: "uuid-a" },
    ]);
  });

  it("セッション UUID を持たないエージェントは除く", () => {
    expect(agentDataSourceItems(snapshot).map((item) => item.value)).not.toContain(null);
    expect(agentDataSourceItems(snapshot)).toHaveLength(2);
  });

  it("オフラインなら空配列を返す", () => {
    expect(agentDataSourceItems(null)).toEqual([]);
  });
});

describe("isAgentDataSourceRequest", () => {
  it("event が getAgents のときだけ true", () => {
    expect(isAgentDataSourceRequest({ event: "getAgents" })).toBe(true);
    expect(isAgentDataSourceRequest({ event: "getAgents", isRefresh: true })).toBe(true);
  });

  it("それ以外は false", () => {
    expect(isAgentDataSourceRequest({ event: "other" })).toBe(false);
    expect(isAgentDataSourceRequest(null)).toBe(false);
    expect(isAgentDataSourceRequest("getAgents")).toBe(false);
  });
});
