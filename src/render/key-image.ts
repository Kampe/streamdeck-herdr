/**
 * エージェントキーの画像を組み立てる純関数。
 *
 * 状態を色で示し、中央にエージェント種別のグリフ、右上にスロット番号を描く
 * （spec/herdr-control.md 5.4）。キーのタイトル（ワークスペース名）は
 * Stream Deck 側が上端に重ねるため、上 1/4 は空けておく。
 */

import {
  EMPTY_SLOT_COLOR,
  EMPTY_SLOT_FOREGROUND_COLOR,
  KEY_IMAGE_SIZE,
  OFFLINE_COLOR,
  OFFLINE_FOREGROUND_COLOR,
  STATUS_COLORS,
  STATUS_FOREGROUND_COLORS,
} from "../constants.js";
import type { AgentStatus } from "../herdr/types.js";
import { agentGlyph, GLYPH_BOX } from "./agent-glyph.js";

export type AgentKeyView =
  /** herdr に接続できていない。 */
  | { kind: "offline" }
  /** 接続はできているが、このスロットに対応するエージェントがいない。 */
  | { kind: "empty"; slot?: number }
  /** エージェントがいる。 */
  | {
      kind: "agent";
      status: AgentStatus;
      agent: string | null;
      slot?: number;
      focused?: boolean;
      flash?: boolean;
    };

/** グリフを描く領域の一辺（px）。上端のタイトルに重ならないよう下寄せに置く。 */
const GLYPH_SIZE = 62;
const GLYPH_CENTER_Y = 88;

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
    parts.push(symbol("×", OFFLINE_FOREGROUND_COLOR, 56));
  } else if (view.kind === "empty") {
    parts.push(symbol("—", EMPTY_SLOT_FOREGROUND_COLOR, 40));
    parts.push(slotBadge(view.slot, EMPTY_SLOT_FOREGROUND_COLOR));
  } else {
    const foreground = STATUS_FOREGROUND_COLORS[view.status];
    parts.push(glyph(view.agent, foreground));
    parts.push(statusBadge(view.status, foreground));
    parts.push(slotBadge(view.slot, foreground));
    if (view.flash === true) {
      parts.push('<rect x="7" y="7" width="130" height="130" rx="14" fill="none" stroke="#ffffff" stroke-width="5" stroke-opacity="0.42"/>');
      parts.push('<path d="M-8 112 112 -8h20L12 132Z" fill="#ffffff" fill-opacity="0.12"/>');
    }
    if (view.focused === true) {
      parts.push(
        `<rect x="5" y="5" width="${KEY_IMAGE_SIZE - 10}" height="${KEY_IMAGE_SIZE - 10}" rx="15" fill="none" stroke="#ffffff" stroke-width="6"/>`,
      );
    }
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

/** エージェント種別のグリフを、上端のタイトルに重ならない位置へ拡大して置く。 */
function glyph(agent: string | null, color: string): string {
  const scale = GLYPH_SIZE / GLYPH_BOX;
  const offsetX = KEY_IMAGE_SIZE / 2 - GLYPH_SIZE / 2;
  const offsetY = GLYPH_CENTER_Y - GLYPH_SIZE / 2;
  return `<g transform="translate(${offsetX} ${offsetY}) scale(${scale})">${agentGlyph(agent, color)}</g>`;
}

/** 空スロット・オフラインを示す記号。 */
function symbol(text: string, fill: string, fontSize: number): string {
  return `<text x="${KEY_IMAGE_SIZE / 2}" y="${GLYPH_CENTER_Y}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="600" fill="${fill}">${text}</text>`;
}

/** A redundant, color-independent state cue for the attention-first fleet view. */
function statusBadge(status: AgentStatus, foreground: string): string {
  const badgeX = KEY_IMAGE_SIZE - 24;
  const badgeY = 24;
  const badgeFill = foreground;
  const badgeText = STATUS_COLORS[status];
  if (status === "working" || status === "idle") {
    return "";
  }
  const glyph = status === "blocked" ? "!" : status === "done" ? "✓" : "?";
  return `<circle cx="${badgeX}" cy="${badgeY}" r="11" fill="${badgeFill}" fill-opacity="0.96" stroke="${badgeText}" stroke-opacity="0.55" stroke-width="2"/><text x="${badgeX}" y="${badgeY + 1}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica,Arial,sans-serif" font-size="15" font-weight="800" fill="${badgeText}">${glyph}</text>`;
}

/** 右下のスロット番号。`index` 指定でないキーには出さない。 */
function slotBadge(slot: number | undefined, fill: string): string {
  if (slot === undefined) {
    return "";
  }
  const x = KEY_IMAGE_SIZE - 30;
  const y = KEY_IMAGE_SIZE - 18;
  return `<rect x="${x - 13}" y="${y - 12}" width="26" height="22" rx="8" fill="#000" fill-opacity="0.28"/><text x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="700" fill="${fill}" fill-opacity="0.9">${slot}</text>`;
}

function toDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
