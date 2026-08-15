import { describe, expect, it } from "vitest";

import {
  EMPTY_SLOT_COLOR,
  OFFLINE_FOREGROUND_COLOR,
  STATUS_COLORS,
  STATUS_FOREGROUND_COLORS,
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

  it("エージェント種別のグリフを埋め込む", () => {
    const claude = render({ kind: "agent", status: "idle", agent: "claude" });
    const codex = render({ kind: "agent", status: "idle", agent: "codex" });

    expect(claude).toContain("<g transform=");
    expect(claude).not.toEqual(codex);
  });

  it("種別が検出できていなければ疑問符を描く", () => {
    expect(render({ kind: "agent", status: "unknown", agent: null })).toContain(">?<");
  });

  it("スロット番号を指定すると右下に描き、指定しなければ描かない", () => {
    expect(render({ kind: "agent", status: "idle", agent: "codex", slot: 3 })).toContain(">3<");
    expect(render({ kind: "agent", status: "idle", agent: "codex" })).not.toContain("text-anchor=\"end\"");
  });

  it("フォーカス中のエージェントだけに強い枠線を描く", () => {
    expect(
      render({ kind: "agent", status: "idle", agent: "codex", focused: true }),
    ).toContain('stroke="#ffffff" stroke-width="6"');
    expect(
      render({ kind: "agent", status: "idle", agent: "codex", focused: false }),
    ).not.toContain('stroke="#ffffff" stroke-width="6"');
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

  it("状態ごとに前景色を変える", () => {
    const idle = render({ kind: "agent", status: "idle", agent: "claude" });
    const working = render({ kind: "agent", status: "working", agent: "claude" });

    expect(idle).toContain(STATUS_FOREGROUND_COLORS.idle);
    expect(working).toContain(STATUS_FOREGROUND_COLORS.working);
  });

  it("keeps routine tiles clean and badges attention states", () => {
    expect(render({ kind: "agent", status: "idle", agent: "codex" })).not.toContain('cx="120" cy="24"');
    expect(render({ kind: "agent", status: "working", agent: "codex" })).not.toContain('cx="120" cy="24"');
    expect(render({ kind: "agent", status: "blocked", agent: "codex" })).toContain(">!<");
    expect(render({ kind: "agent", status: "done", agent: "codex" })).toContain(">✓<");
  });

  it("renders the fleet slot in a high-contrast chip", () => {
    expect(render({ kind: "agent", status: "idle", agent: "codex", slot: 3 })).toContain('rx="8"');
  });

  it("supports a restrained completion shimmer", () => {
    const svg = render({ kind: "agent", status: "done", agent: "codex", flash: true });
    expect(svg).toContain('stroke-opacity="0.42"');
    expect(svg).toContain('fill-opacity="0.12"');
  });
});
