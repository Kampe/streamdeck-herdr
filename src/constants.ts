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
export const ACTION_UUID_PAGE_PREVIOUS = `${PLUGIN_UUID}.page-previous`;
export const ACTION_UUID_PAGE_NEXT = `${PLUGIN_UUID}.page-next`;
export const ACTION_UUID_PANE_SPLIT = `${PLUGIN_UUID}.pane-split`;
export const ACTION_UUID_PANE_SWAP = `${PLUGIN_UUID}.pane-swap`;
export const ACTION_UUID_PANE_CLOSE = `${PLUGIN_UUID}.pane-close`;

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

/**
 * スナップショット再取得の最短間隔。
 * エージェントが出力している間 `pane.updated` が絶え間なく飛ぶため、
 * デバウンスだけでは取得が止まらない。上限を設けて頭打ちにする。
 */
export const SNAPSHOT_MIN_INTERVAL_MS = 1_000;

/** 1 リクエストの応答を待つ上限。 */
export const REQUEST_TIMEOUT_MS = 5_000;

/**
 * 構成の変化を知るために購読するイベント種別。
 *
 * `pane.updated` / `workspace.focused` / `tab.focused` は入れない。エージェントが
 * 出力している間これらが毎秒 30 件近く流れ、スナップショットの取り直しが止まらなくなる。
 * ここで拾うのはペインやワークスペースの増減・改名・フォーカス移動だけにする。
 */
export const STRUCTURE_SUBSCRIPTION_TYPES: readonly string[] = [
  "workspace.created",
  "workspace.renamed",
  "workspace.closed",
  "tab.created",
  "tab.closed",
  "pane.created",
  "pane.closed",
  "pane.focused",
  "pane.agent_detected",
];

/**
 * エージェントの状態変化イベント。購読時に `pane_id` を要求するため、
 * エージェントのいるペインごとに購読する。状態はこのイベントで即座に反映し、
 * スナップショットの取り直しを待たない。
 */
export const AGENT_STATUS_EVENT = "pane.agent_status_changed";

/** 状態ごとのキー背景色（spec/herdr-control.md 5.4「表示」）。 */
export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "#0d0f13",
  working: "#f08c00",
  blocked: "#e03131",
  done: "#6fd3f2",
  unknown: "#3a3f47",
};

/** 状態ごとの前景色（背景とのコントラストを確保する）。 */
export const STATUS_FOREGROUND_COLORS: Record<AgentStatus, string> = {
  idle: "#e8ecf2",
  working: "#1c1f26",
  blocked: "#ffffff",
  done: "#10222b",
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

/** キーのタイトル（下端に重なる文字列）の最大文字数。 */
export const KEY_TITLE_MAX_LENGTH = 12;
