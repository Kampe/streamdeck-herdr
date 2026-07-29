import { describe, expect, it } from "vitest";

import { parseKeySequence, resolveKeys } from "./keys.js";

describe("resolveKeys", () => {
  it("プリセットごとに仕様どおりのキー列を返す", () => {
    expect(resolveKeys("approve", undefined)).toEqual(["Enter"]);
    expect(resolveKeys("reject", undefined)).toEqual(["esc"]);
    expect(resolveKeys("yes", undefined)).toEqual(["y", "Enter"]);
    expect(resolveKeys("no", undefined)).toEqual(["n", "Enter"]);
  });

  it("プリセット未設定なら approve を使う", () => {
    expect(resolveKeys(undefined, undefined)).toEqual(["Enter"]);
  });

  it("custom は自由入力をパースする", () => {
    expect(resolveKeys("custom", "2 Enter")).toEqual(["2", "Enter"]);
  });

  it("custom で入力が空なら空配列を返す", () => {
    expect(resolveKeys("custom", "")).toEqual([]);
    expect(resolveKeys("custom", "   ")).toEqual([]);
    expect(resolveKeys("custom", undefined)).toEqual([]);
  });

  it("返り値を書き換えてもプリセットの定義は壊れない", () => {
    const keys = resolveKeys("approve", undefined);
    keys.push("esc");

    expect(resolveKeys("approve", undefined)).toEqual(["Enter"]);
  });
});

describe("parseKeySequence", () => {
  it("連続空白と前後の空白を無視する", () => {
    expect(parseKeySequence("  y   Enter  ")).toEqual(["y", "Enter"]);
  });

  it("タブや改行も区切りとして扱う", () => {
    expect(parseKeySequence("y\tEnter\nesc")).toEqual(["y", "Enter", "esc"]);
  });

  it("Escape の表記ゆれは esc に正規化する", () => {
    expect(parseKeySequence("Escape escape ESC esc")).toEqual(["esc", "esc", "esc", "esc"]);
  });

  it("Escape 以外のキーは大文字小文字をそのまま保つ", () => {
    expect(parseKeySequence("Enter y Tab")).toEqual(["Enter", "y", "Tab"]);
  });

  it("空文字は空配列になる", () => {
    expect(parseKeySequence("")).toEqual([]);
  });
});
