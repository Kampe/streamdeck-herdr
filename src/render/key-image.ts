/**
 * エージェントキーの画像を組み立てる純関数。
 *
 * 状態を色で示し、中央にエージェント種別、右上にスロット番号を描く
 * （spec/herdr-control.md 5.4）。キーのタイトル（ワークスペース名）は
 * Stream Deck 側が下端に重ねるため、下 1/4 は空けておく。
 */

import {
  EMPTY_SLOT_COLOR,
  EMPTY_SLOT_FOREGROUND_COLOR,
  KEY_IMAGE_SIZE,
  KEY_LABEL_MAX_LENGTH,
  OFFLINE_COLOR,
  OFFLINE_FOREGROUND_COLOR,
  STATUS_COLORS,
  STATUS_FOREGROUND_COLORS,
} from "../constants.js";
import type { AgentStatus } from "../herdr/types.js";

export type AgentKeyView =
  /** herdr に接続できていない。 */
  | { kind: "offline" }
  /** 接続はできているが、このスロットに対応するエージェントがいない。 */
  | { kind: "empty"; slot?: number }
  /** エージェントがいる。 */
  | { kind: "agent"; status: AgentStatus; agent: string | null; slot?: number };

/** キー画像を `data:` URI として返す。Stream Deck の `setImage()` にそのまま渡せる。 */
export function renderAgentKey(view: AgentKeyView): string {
  return toDataUri(buildSvg(view));
}

function buildSvg(view: AgentKeyView): string {
  const size = KEY_IMAGE_SIZE;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    background(view),
  ];

  if (view.kind === "offline") {
    parts.push(centerText("×", OFFLINE_FOREGROUND_COLOR, 56));
  } else if (view.kind === "empty") {
    parts.push(centerText("—", EMPTY_SLOT_FOREGROUND_COLOR, 40));
    parts.push(slotBadge(view.slot, EMPTY_SLOT_FOREGROUND_COLOR));
  } else {
    const foreground = STATUS_FOREGROUND_COLORS[view.status];
    parts.push(centerText(agentLabel(view.agent), foreground, 24));
    parts.push(slotBadge(view.slot, foreground));
  }

  parts.push("</svg>");
  return parts.join("");
}

function background(view: AgentKeyView): string {
  const size = KEY_IMAGE_SIZE;
  const fill =
    view.kind === "offline"
      ? OFFLINE_COLOR
      : view.kind === "empty"
        ? EMPTY_SLOT_COLOR
        : STATUS_COLORS[view.status];

  const rect = `<rect x="0" y="0" width="${size}" height="${size}" rx="18" fill="${fill}"/>`;
  if (view.kind === "agent") {
    return rect;
  }

  // 空スロットとオフラインは、塗りだけでは区別しにくいので破線の枠を足す。
  const stroke = view.kind === "offline" ? OFFLINE_FOREGROUND_COLOR : EMPTY_SLOT_FOREGROUND_COLOR;
  return `${rect}<rect x="6" y="6" width="${size - 12}" height="${size - 12}" rx="14" fill="none" stroke="${stroke}" stroke-width="3" stroke-dasharray="10 8"/>`;
}

/** 中央よりやや上に描く。下端は Stream Deck のタイトルに譲る。 */
function centerText(text: string, fill: string, fontSize: number): string {
  return `<text x="${KEY_IMAGE_SIZE / 2}" y="58" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="600" fill="${fill}">${escapeXml(text)}</text>`;
}

/** 右上のスロット番号。`index` 指定でないキーには出さない。 */
function slotBadge(slot: number | undefined, fill: string): string {
  if (slot === undefined) {
    return "";
  }
  return `<text x="${KEY_IMAGE_SIZE - 14}" y="26" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="600" fill="${fill}" fill-opacity="0.65">${escapeXml(String(slot))}</text>`;
}

/** エージェント種別を大文字で描く。未検出なら疑問符。 */
function agentLabel(agent: string | null): string {
  if (agent === null || agent === "") {
    return "?";
  }
  return truncate(agent.toUpperCase(), KEY_LABEL_MAX_LENGTH);
}

function truncate(text: string, maxLength: number): string {
  return [...text].length <= maxLength ? text : `${[...text].slice(0, maxLength - 1).join("")}…`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
