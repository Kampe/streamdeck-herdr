/**
 * キーの設定から、操作対象のエージェントを決める純関数。
 *
 * `agent.*` の `target` に渡せるのは pane_id だけで、pane_id はペインの開閉で
 * 振り直される。よって設定には恒久 ID（エージェントセッション UUID）を保存し、
 * 使う直前に毎回ここで pane_id へ解決する（spec/herdr-control.md 5.2）。
 */

import type { TargetBinding, TargetSettings } from "../settings.js";
import type { AgentInfo, SessionSnapshot } from "./types.js";

/** Herdr's attention-first ordering, with stable structural tie-breakers. */
const STATUS_PRIORITY: Record<AgentInfo["status"], number> = {
  blocked: 0,
  done: 1,
  unknown: 2,
  working: 3,
  idle: 4,
};

/**
 * エージェントを表示順に並べる。対応が必要な状態を先にし、同じ状態では
 * ワークスペース番号、pane_id の順で安定させる。ワークスペースが見つからない
 * ものは同じ優先度の中で末尾に送る。
 */
export function sortAgents(snapshot: SessionSnapshot): AgentInfo[] {
  const orderOf = new Map(
    snapshot.workspaces.map((workspace) => [workspace.workspaceId, workspace.number]),
  );

  return [...snapshot.agents].sort((left, right) => {
    const leftPriority = STATUS_PRIORITY[left.status];
    const rightPriority = STATUS_PRIORITY[right.status];
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    const leftOrder = orderOf.get(left.workspaceId) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderOf.get(right.workspaceId) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.paneId.localeCompare(right.paneId);
  });
}

/**
 * 設定に対応するエージェントを返す。見つからなければ null。
 *
 * @param fallbackBinding `binding` 未設定のときに使う既定。`agent-slot` は `index`、
 *   それ以外のアクションは `focused` を渡す。
 */
export function resolveAgent(
  settings: TargetSettings,
  snapshot: SessionSnapshot | null,
  fallbackBinding: TargetBinding,
): AgentInfo | null {
  if (snapshot === null) {
    return null;
  }

  switch (settings.binding ?? fallbackBinding) {
    case "focused":
      return snapshot.agents.find((agent) => agent.paneId === snapshot.focusedPaneId) ?? null;
    case "index":
      return sortAgents(snapshot)[(settings.index ?? 1) - 1] ?? null;
    case "session":
      if (settings.sessionId === undefined || settings.sessionId === "") {
        return null;
      }
      return snapshot.agents.find((agent) => agent.sessionId === settings.sessionId) ?? null;
  }
}

/** 解決したエージェントの pane_id。見つからなければ null。 */
export function resolveTarget(
  settings: TargetSettings,
  snapshot: SessionSnapshot | null,
  fallbackBinding: TargetBinding,
): string | null {
  return resolveAgent(settings, snapshot, fallbackBinding)?.paneId ?? null;
}
