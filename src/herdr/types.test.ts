import { describe, expect, it } from "vitest";

import { parseHerdrMessage, parseSessionSnapshot } from "./types.js";

/** `session.snapshot` の応答 1 件分を組み立てる。 */
function snapshotResult(overrides: Record<string, unknown> = {}): unknown {
  return {
    type: "session_snapshot",
    snapshot: {
      protocol: 17,
      version: "0.7.5",
      focused_pane_id: "wE:p1",
      agents: [agentJson()],
      workspaces: [workspaceJson()],
      ...overrides,
    },
  };
}

function agentJson(overrides: Record<string, unknown> = {}): unknown {
  return {
    agent: "claude",
    agent_session: {
      agent: "claude",
      kind: "id",
      source: "herdr:claude",
      value: "0326410b-873b-494b-8b0f-74c2c1fb6ca8",
    },
    agent_status: "working",
    cwd: "/Users/yuto/src/example",
    focused: true,
    pane_id: "wE:p1",
    tab_id: "wE:t1",
    terminal_title: "⠐ 作業中のタスク",
    terminal_title_stripped: "作業中のタスク",
    workspace_id: "wE",
    ...overrides,
  };
}

function workspaceJson(overrides: Record<string, unknown> = {}): unknown {
  return {
    active_tab_id: "wE:t1",
    agent_status: "working",
    focused: true,
    label: "example",
    number: 8,
    workspace_id: "wE",
    ...overrides,
  };
}

describe("parseSessionSnapshot", () => {
  it("エージェントとワークスペースを内部型へ写像する", () => {
    const snapshot = parseSessionSnapshot(snapshotResult());

    expect(snapshot).not.toBeNull();
    expect(snapshot?.focusedPaneId).toBe("wE:p1");
    expect(snapshot?.agents).toEqual([
      {
        paneId: "wE:p1",
        workspaceId: "wE",
        tabId: "wE:t1",
        agent: "claude",
        sessionId: "0326410b-873b-494b-8b0f-74c2c1fb6ca8",
        status: "working",
        title: "作業中のタスク",
        cwd: "/Users/yuto/src/example",
        focused: true,
      },
    ]);
    expect(snapshot?.workspaces).toEqual([{ workspaceId: "wE", label: "example", number: 8 }]);
  });

  it("pane_id が欠けたエージェントはスキップし、他のエージェントは残す", () => {
    const broken = agentJson({ pane_id: undefined });
    const healthy = agentJson({ pane_id: "wB:p1", workspace_id: "wB", tab_id: "wB:t1" });

    const snapshot = parseSessionSnapshot(snapshotResult({ agents: [broken, healthy] }));

    expect(snapshot?.agents.map((agent) => agent.paneId)).toEqual(["wB:p1"]);
  });

  it("未知の agent_status は unknown に落とす", () => {
    const snapshot = parseSessionSnapshot(
      snapshotResult({ agents: [agentJson({ agent_status: "compiling" })] }),
    );

    expect(snapshot?.agents[0]?.status).toBe("unknown");
  });

  it("agent_status が欠けていても unknown として扱う", () => {
    const snapshot = parseSessionSnapshot(
      snapshotResult({ agents: [agentJson({ agent_status: undefined })] }),
    );

    expect(snapshot?.agents[0]?.status).toBe("unknown");
  });

  it("agent_session が path 形式なら恒久 ID として採らない", () => {
    const snapshot = parseSessionSnapshot(
      snapshotResult({
        agents: [agentJson({ agent_session: { kind: "path", value: "/tmp/session.json" } })],
      }),
    );

    expect(snapshot?.agents[0]?.sessionId).toBeNull();
  });

  it("agents が配列でなければ null を返す", () => {
    expect(parseSessionSnapshot(snapshotResult({ agents: null }))).toBeNull();
    expect(parseSessionSnapshot(snapshotResult({ agents: "wE:p1" }))).toBeNull();
  });

  it("snapshot が無い / オブジェクトでない場合は null を返す", () => {
    expect(parseSessionSnapshot(null)).toBeNull();
    expect(parseSessionSnapshot({})).toBeNull();
    expect(parseSessionSnapshot({ snapshot: [] })).toBeNull();
  });

  it("workspaces が壊れていてもエージェントは失わない", () => {
    const snapshot = parseSessionSnapshot(snapshotResult({ workspaces: "broken" }));

    expect(snapshot?.workspaces).toEqual([]);
    expect(snapshot?.agents).toHaveLength(1);
  });

  it("label が無いワークスペースは workspace_id をラベルにする", () => {
    const snapshot = parseSessionSnapshot(
      snapshotResult({ workspaces: [workspaceJson({ label: undefined, number: undefined })] }),
    );

    expect(snapshot?.workspaces[0]).toEqual({
      workspaceId: "wE",
      label: "wE",
      number: Number.MAX_SAFE_INTEGER,
    });
  });

  it("focused_pane_id が無ければ null にする", () => {
    const snapshot = parseSessionSnapshot(snapshotResult({ focused_pane_id: undefined }));

    expect(snapshot?.focusedPaneId).toBeNull();
  });
});

describe("parseHerdrMessage", () => {
  it("成功応答を result として分類する", () => {
    expect(parseHerdrMessage({ id: "r1", result: { type: "pong" } })).toEqual({
      kind: "result",
      id: "r1",
      result: { type: "pong" },
    });
  });

  it("エラー応答を error として分類する", () => {
    expect(
      parseHerdrMessage({ id: "r1", error: { code: "not_found", message: "pane not found" } }),
    ).toEqual({ kind: "error", id: "r1", code: "not_found", message: "pane not found" });
  });

  it("code / message が欠けたエラーでも既定値を入れて分類する", () => {
    expect(parseHerdrMessage({ id: "r1", error: {} })).toEqual({
      kind: "error",
      id: "r1",
      code: "unknown",
      message: "詳細不明のエラー",
    });
  });

  it("id を持たないイベントを event として分類する", () => {
    expect(parseHerdrMessage({ event: "pane_updated", data: { type: "pane_updated" } })).toEqual({
      kind: "event",
      event: "pane_updated",
      data: { type: "pane_updated" },
    });
  });

  it("id と event の両方を持つ行はイベントとして扱う", () => {
    const message = parseHerdrMessage({ id: "", event: "pane_created", data: {} });

    expect(message?.kind).toBe("event");
  });

  it("どちらにも当てはまらない行は null を返す", () => {
    expect(parseHerdrMessage(null)).toBeNull();
    expect(parseHerdrMessage([])).toBeNull();
    expect(parseHerdrMessage({ id: "r1" })).toBeNull();
    expect(parseHerdrMessage({ result: {} })).toBeNull();
  });
});
