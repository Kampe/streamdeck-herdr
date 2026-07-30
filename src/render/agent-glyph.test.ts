import { describe, expect, it } from "vitest";

import { agentGlyph } from "./agent-glyph.js";

describe("agentGlyph", () => {
  it("ロゴを用意した種別は種別ごとに違うグリフを返す", () => {
    const glyphs = ["claude", "codex", "gemini", "cursor"].map((agent) =>
      agentGlyph(agent, "#fff"),
    );

    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("大文字小文字を区別せずにロゴを引く", () => {
    expect(agentGlyph("CLAUDE", "#fff")).toBe(agentGlyph("claude", "#fff"));
  });

  it("穴あきのロゴは evenodd で塗る", () => {
    expect(agentGlyph("codex", "#fff")).toContain('fill-rule="evenodd"');
    expect(agentGlyph("claude", "#fff")).not.toContain("fill-rule");
  });

  it("ロゴを用意していない種別は頭 2 文字を大文字で描く", () => {
    expect(agentGlyph("opencode", "#fff")).toContain(">OP<");
    expect(agentGlyph("cline", "#fff")).toContain(">CL<");
  });

  it("種別が検出できていなければ疑問符を描く", () => {
    expect(agentGlyph(null, "#fff")).toContain(">?<");
    expect(agentGlyph("", "#fff")).toContain(">?<");
  });

  it("渡した色を使う", () => {
    expect(agentGlyph("claude", "#123456")).toContain("#123456");
    expect(agentGlyph("opencode", "#123456")).toContain("#123456");
  });

  it("種別名の XML 特殊文字をエスケープする", () => {
    const glyph = agentGlyph("<&", "#fff");

    expect(glyph).toContain("&lt;&amp;");
    expect(glyph).not.toContain(">&<");
  });
});
