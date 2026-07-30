/**
 * `agent.send_keys` に渡すキー列を組み立てる純関数。
 *
 * 承認 / 拒否のプリセットはエージェント共通で使える最小のものに絞り、
 * エージェント固有の選択肢（`2` + `Enter` 等）は自由入力で書けるようにする
 * （spec/herdr-control.md 5.3）。
 */

import type { KeyPreset } from "../settings.js";

/** Escape の正規名。herdr は `escape` も受け付けるが送信は `esc` に揃える。 */
const ESCAPE_KEY = "esc";

/**
 * プリセットごとに送るキー列。
 *
 * `reject` と `interrupt` はどちらも Esc を送る。送るキーは同じでも、
 * 承認プロンプトを取り消すのか、走っている処理を止めるのかで押す動機が違うため、
 * ラベルとアイコンを分けて両方置いてある。
 */
export const KEY_PRESETS: Record<Exclude<KeyPreset, "custom">, readonly string[]> = {
  approve: ["Enter"],
  reject: [ESCAPE_KEY],
  yes: ["y", "Enter"],
  no: ["n", "Enter"],
  interrupt: [ESCAPE_KEY],
};

/**
 * 空白区切りのキー列をパースする。連続空白・前後の空白は無視する。
 * Escape の表記ゆれ（`escape` / `ESC` 等）は `esc` に正規化する。
 */
export function parseKeySequence(text: string): string[] {
  return text
    .split(/\s+/)
    .filter((key) => key !== "")
    .map((key) => (isEscapeKey(key) ? ESCAPE_KEY : key));
}

function isEscapeKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return lowered === "esc" || lowered === "escape";
}

/**
 * 設定から実際に送るキー列を決める。
 * 空配列を返した場合、呼び出し側は送信せずにエラー表示すること。
 */
export function resolveKeys(preset: KeyPreset | undefined, custom: string | undefined): string[] {
  if (preset === "custom") {
    return parseKeySequence(custom ?? "");
  }
  return [...KEY_PRESETS[preset ?? "approve"]];
}
