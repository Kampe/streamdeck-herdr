/**
 * キーのタイトル（Stream Deck が画像の下端に重ねる文字列）を決める純関数。
 */

import { KEY_TITLE_MAX_LENGTH } from "../constants.js";
import type { AgentSlotSettings } from "../settings.js";
import type { AgentInfo, SessionSnapshot } from "../herdr/types.js";

/**
 * エージェントキーのタイトルを返す。
 *
 * - `workspace`（既定）: ワークスペース名
 * - `title`: 端末タイトル（エージェントが出している作業内容）
 * - `custom`: ユーザーが入れた固定文字列。エージェントがいなくても表示する
 */
export function resolveSlotTitle(
  settings: AgentSlotSettings,
  agent: AgentInfo | null,
  snapshot: SessionSnapshot | null,
): string {
  const source = settings.labelSource ?? "workspace";

  if (source === "custom") {
    return truncateTitle(settings.customLabel ?? "");
  }
  if (agent === null) {
    return "";
  }
  if (source === "title") {
    return truncateTitle(agent.title);
  }

  const workspace = snapshot?.workspaces.find((item) => item.workspaceId === agent.workspaceId);
  return truncateTitle(workspace?.label ?? agent.workspaceId);
}

function truncateTitle(text: string): string {
  const characters = [...text.trim()];
  if (characters.length <= KEY_TITLE_MAX_LENGTH) {
    return characters.join("");
  }
  return `${characters.slice(0, KEY_TITLE_MAX_LENGTH - 1).join("")}…`;
}
