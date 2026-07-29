import { describe, expect, it } from "vitest";

import {
  EMPTY_SLOT_COLOR,
  OFFLINE_FOREGROUND_COLOR,
  STATUS_COLORS,
} from "../constants.js";
import { renderAgentKey, type AgentKeyView } from "./key-image.js";

const DATA_URI_PREFIX = "data:image/svg+xml;base64,";

/** `data:` URI を SVG の文字列に戻す。 */
function decode(dataUri: string): string {
  expect(dataUri.startsWith(DATA_URI_PREFIX)).toBe(true);
  return Buffer.from(dataUri.slice(DATA_URI_PREFIX.length), "base64").toString("utf8");
}

function render(view: AgentKeyView): string {
  return decode(renderAgentKey(view));
}

describe("renderAgentKey", () => {
  it("data:image/svg+xml;base64, で始まる URI を返す", () => {
    expect(renderAgentKey({ kind: "offline" }).startsWith(DATA_URI_PREFIX)).toBe(true);
  });

  it("状態ごとに定数の背景色を使う", () => {
    for (const status of ["idle", "working", "blocked", "done", "unknown"] as const) {
      const svg = render({ kind: "agent", status, agent: "claude" });

      expect(svg).toContain(STATUS_COLORS[status]);
    }
  });

  it("エージェント種別を大文字で描く", () => {
    expect(render({ kind: "agent", status: "idle", agent: "claude" })).toContain(">CLAUDE<");
  });

  it("種別が検出できていなければ疑問符を描く", () => {
    expect(render({ kind: "agent", status: "unknown", agent: null })).toContain(">?<");
  });

  it("スロット番号を指定すると右上に描き、指定しなければ描かない", () => {
    expect(render({ kind: "agent", status: "idle", agent: "codex", slot: 3 })).toContain(">3<");
    expect(render({ kind: "agent", status: "idle", agent: "codex" })).not.toContain("text-anchor=\"end\"");
  });

  it("空スロットは専用色と破線枠で描く", () => {
    const svg = render({ kind: "empty", slot: 2 });

    expect(svg).toContain(EMPTY_SLOT_COLOR);
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain(">—<");
  });

  it("オフラインは空スロットと違う見た目にする", () => {
    const offline = render({ kind: "offline" });
    const empty = render({ kind: "empty" });

    expect(offline).toContain(OFFLINE_FOREGROUND_COLOR);
    expect(offline).toContain(">×<");
    expect(offline).not.toEqual(empty);
  });

  it("XML の特殊文字をエスケープする", () => {
    const svg = render({ kind: "agent", status: "idle", agent: "a&b<c>\"d'" });

    expect(svg).toContain("A&amp;B&lt;C&gt;&quot;D&apos;");
    expect(svg).not.toContain("<c>");
  });

  it("長すぎる種別名は省略記号付きで切り詰める", () => {
    const svg = render({ kind: "agent", status: "idle", agent: "abcdefghijklmn" });

    expect(svg).toContain(">ABCDEFGHI…<");
  });
});
