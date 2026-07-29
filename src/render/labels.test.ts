import { describe, expect, it } from "vitest";

import { resolveSlotTitle } from "./labels.js";
import type { AgentInfo, SessionSnapshot } from "../herdr/types.js";

const agent: AgentInfo = {
  paneId: "wA:p1",
  workspaceId: "wA",
  tabId: "wA:t1",
  agent: "claude",
  sessionId: "uuid-a1",
  status: "working",
  title: "認証まわりのリファクタリング",
  cwd: "/Users/yuto/src/alpha",
  focused: true,
};

const snapshot: SessionSnapshot = {
  agents: [agent],
  workspaces: [{ workspaceId: "wA", label: "alpha", number: 1 }],
  focusedPaneId: "wA:p1",
};

describe("resolveSlotTitle", () => {
  it("既定ではワークスペース名を返す", () => {
    expect(resolveSlotTitle({}, agent, snapshot)).toBe("alpha");
  });

  it("ワークスペース情報が無ければ workspace_id を返す", () => {
    expect(resolveSlotTitle({}, agent, { ...snapshot, workspaces: [] })).toBe("wA");
  });

  it("title 指定なら端末タイトルを返し、長ければ切り詰める", () => {
    expect(resolveSlotTitle({ labelSource: "title" }, agent, snapshot)).toBe("認証まわりのリファクタ…");
  });

  it("custom 指定ならエージェントがいなくても固定文字列を返す", () => {
    expect(resolveSlotTitle({ labelSource: "custom", customLabel: "作業中" }, null, null)).toBe(
      "作業中",
    );
  });

  it("custom で文字列が無ければ空文字を返す", () => {
    expect(resolveSlotTitle({ labelSource: "custom" }, agent, snapshot)).toBe("");
  });

  it("エージェントがいなければ空文字を返す", () => {
    expect(resolveSlotTitle({}, null, snapshot)).toBe("");
    expect(resolveSlotTitle({ labelSource: "title" }, null, snapshot)).toBe("");
  });

  it("前後の空白を落とす", () => {
    expect(resolveSlotTitle({ labelSource: "custom", customLabel: "  build  " }, null, null)).toBe(
      "build",
    );
  });
});
