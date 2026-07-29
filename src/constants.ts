/**
 * プラグイン全体で共有する定数。
 *
 * 間隔・色・パスなどのハードコード値はここだけに置く
 * （spec/herdr-control.md 6章「コーディング規約」）。
 */

import { homedir } from "node:os";
import { join } from "node:path";

import type { AgentStatus } from "./herdr/types.js";

export const PLUGIN_UUID = "com.github.yuntan.herdr";

export const ACTION_UUID_AGENT_SLOT = `${PLUGIN_UUID}.agent-slot`;
export const ACTION_UUID_SEND_KEYS = `${PLUGIN_UUID}.send-keys`;
export const ACTION_UUID_PROMPT = `${PLUGIN_UUID}.prompt`;
export const ACTION_UUID_INTERRUPT = `${PLUGIN_UUID}.interrupt`;

/**
 * 既定のソケットパス。Stream Deck のプラグインプロセスは herdr の環境変数を
 * 継承しないため、`HERDR_SOCKET_PATH` に頼らず既定値を組み立てる。
 * 名前付きセッションを使う場合は globalSettings で上書きする。
 */
export const DEFAULT_SOCKET_PATH = join(homedir(), ".config", "herdr", "herdr.sock");

/** 切断後に再接続を試みる間隔。 */
export const RECONNECT_INTERVAL_MS = 2_000;

/** イベントを受けてからスナップショットを取り直すまでの待ち時間（連続イベントをまとめる）。 */
export const SNAPSHOT_DEBOUNCE_MS = 150;

/** 1 リクエストの応答を待つ上限。 */
export const REQUEST_TIMEOUT_MS = 5_000;

/**
 * 購読するイベント種別。`pane.agent_status_changed` は購読時に `pane_id` を要求し
 * スロットの割り当てが変わるたびに張り替えが要るため使わない。
 * ペインの状態変化は `pane.updated` で拾える。
 */
export const SUBSCRIPTION_TYPES: readonly string[] = [
  "workspace.created",
  "workspace.updated",
  "workspace.closed",
  "workspace.focused",
  "tab.created",
  "tab.closed",
  "tab.focused",
  "pane.created",
  "pane.updated",
  "pane.closed",
];

/** 状態ごとのキー背景色（spec/herdr-control.md 5.4「表示」）。 */
export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "#e8ecf2",
  working: "#2f7bd6",
  blocked: "#d99024",
  done: "#2f9e5f",
  unknown: "#3a3f47",
};

/** 状態ごとの前景色（背景とのコントラストを確保する）。 */
export const STATUS_FOREGROUND_COLORS: Record<AgentStatus, string> = {
  idle: "#1c1f26",
  working: "#ffffff",
  blocked: "#1c1f26",
  done: "#ffffff",
  unknown: "#9aa1ad",
};

/** 対応するエージェントがいないスロットの色。 */
export const EMPTY_SLOT_COLOR = "#14161b";
export const EMPTY_SLOT_FOREGROUND_COLOR = "#5c636e";

/** herdr に接続できていないときの色。 */
export const OFFLINE_COLOR = "#14161b";
export const OFFLINE_FOREGROUND_COLOR = "#b04a4a";

/** キー画像の一辺（px）。Stream Deck のキーは正方形。 */
export const KEY_IMAGE_SIZE = 144;

/** キー画像に描くラベルの最大文字数。超えた分は省略記号にする。 */
export const KEY_LABEL_MAX_LENGTH = 10;

/** キーのタイトル（下端に重なる文字列）の最大文字数。 */
export const KEY_TITLE_MAX_LENGTH = 12;
