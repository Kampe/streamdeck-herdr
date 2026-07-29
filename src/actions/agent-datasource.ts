/**
 * Property Inspector のエージェント選択ドロップダウンに渡す選択肢。
 *
 * PI からソケットを開かず、プラグインが持っているスナップショットから供給する
 * （spec/herdr-control.md 5.5）。
 */

import { sortAgents } from "../herdr/target.js";
import type { SessionSnapshot } from "../herdr/types.js";

/** sdpi-components の `datasource` 名。PI とプラグインで同じ文字列を使う。 */
export const AGENT_DATA_SOURCE = "getAgents";

export type DataSourceItem = { label: string; value: string };

/** PI から届いたメッセージがエージェント一覧の要求かどうか。 */
export function isAgentDataSourceRequest(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { event?: unknown }).event === AGENT_DATA_SOURCE
  );
}

/**
 * 恒久 ID を持つエージェントだけを選択肢にする。
 * セッション UUID が取れないエージェントは固定できないので除く。
 */
export function agentDataSourceItems(snapshot: SessionSnapshot | null): DataSourceItem[] {
  if (snapshot === null) {
    return [];
  }

  const labelOf = new Map(
    snapshot.workspaces.map((workspace) => [workspace.workspaceId, workspace.label]),
  );

  return sortAgents(snapshot)
    .filter((agent): agent is typeof agent & { sessionId: string } => agent.sessionId !== null)
    .map((agent) => ({
      label: `${labelOf.get(agent.workspaceId) ?? agent.workspaceId} · ${agent.agent ?? "?"}`,
      value: agent.sessionId,
    }));
}
