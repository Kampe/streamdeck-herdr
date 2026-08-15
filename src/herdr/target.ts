/**
 * キーの設定から、操作対象のエージェントを決める純関数。
 *
 * `agent.*` の `target` に渡せるのは pane_id だけで、pane_id はペインの開閉で
 * 振り直される。よって設定には恒久 ID（エージェントセッション UUID）を保存し、
 * 使う直前に毎回ここで pane_id へ解決する（spec/herdr-control.md 5.2）。
 */

import type { TargetBinding, TargetSettings } from "../settings.js";
import type { AgentInfo, SessionSnapshot } from "./types.js";

/**
 * Herdr が返したスナップショットの表示順をそのまま使う。
 * Herdr 自身が状態やワークスペースを並べ替えるため、ここで別の優先度を
 * 再適用すると Stream Deck と Herdr の順番がずれてしまう。
 */
export function sortAgents(snapshot: SessionSnapshot): AgentInfo[] {
  return [...snapshot.agents];
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
