/**
 * Stream Deck Neo（4 列 × 2 段）用の既定プロファイルを生成する。
 *
 * `.streamDeckProfile` は `.sdProfile` ディレクトリを固めた zip。手で作ると
 * 中身が読めないので、配置をこのスクリプトに書いて生成する。
 *
 *   node scripts/build-profile.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN_UUID = "com.github.yuntan.herdr";
const PLUGIN_NAME = "herdr";
const PLUGIN_VERSION = "0.1.0.0";

const OUTPUT = "com.github.yuntan.herdr.sdPlugin/profiles/herdr-neo.streamDeckProfile";

/** プロファイル / ページの識別子。生成物を安定させるため固定値にする。 */
const PROFILE_ID = "7B7B4E8A-4C0B-4F7C-9E52-6C2A5F5E1A01";
const PAGE_ID = "7B7B4E8A-4C0B-4F7C-9E52-6C2A5F5E1A02";

/**
 * 上段はエージェント 1〜4、下段は承認 / 拒否 / 中断 / プロンプト。
 * 座標は `"列,段"`（0 始まり）。
 */
const KEYS = [
  ["0,0", "agent-slot", "エージェント", { binding: "index", index: 1 }],
  ["1,0", "agent-slot", "エージェント", { binding: "index", index: 2 }],
  ["2,0", "agent-slot", "エージェント", { binding: "index", index: 3 }],
  ["3,0", "agent-slot", "エージェント", { binding: "index", index: 4 }],
  ["0,1", "send-keys", "キー送信", { binding: "focused", preset: "approve" }],
  ["1,1", "send-keys", "キー送信", { binding: "focused", preset: "reject" }],
  ["2,1", "interrupt", "中断", { binding: "focused" }],
  ["3,1", "prompt", "プロンプト送信", { binding: "focused", text: "" }],
];

function actionEntry(index, actionName, name, settings) {
  return {
    // ActionID は一意であればよい。生成のたびに変わらないよう連番から作る。
    ActionID: `${PROFILE_ID.slice(0, 24)}${String(index).padStart(12, "0")}`,
    Name: name,
    Plugin: { Name: PLUGIN_NAME, UUID: PLUGIN_UUID, Version: PLUGIN_VERSION },
    Resources: null,
    Settings: settings,
    State: 0,
    States: [{}],
    UUID: `${PLUGIN_UUID}.${actionName}`,
  };
}

function build() {
  const staging = mkdtempSync(join(tmpdir(), "herdr-profile-"));
  const root = join(staging, "herdr-neo.sdProfile");
  const page = join(root, "Profiles", PAGE_ID);
  mkdirSync(join(page, "Images"), { recursive: true });

  const actions = {};
  KEYS.forEach(([coordinates, actionName, name, settings], index) => {
    actions[coordinates] = actionEntry(index, actionName, name, settings);
  });

  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify({
      Device: { Model: "", UUID: "" },
      Name: "herdr",
      Pages: {
        Current: PAGE_ID.toLowerCase(),
        Default: PAGE_ID.toLowerCase(),
        Pages: [PAGE_ID.toLowerCase()],
      },
      Version: "3.0",
    }),
  );

  writeFileSync(
    join(page, "manifest.json"),
    JSON.stringify({
      Controllers: [{ Actions: actions, Type: "Keypad" }],
      Icon: "",
      Name: "",
    }),
  );

  rmSync(OUTPUT, { force: true });
  execFileSync("zip", ["-r", "-q", "-X", join(staging, "profile.zip"), "herdr-neo.sdProfile"], {
    cwd: staging,
  });
  execFileSync("cp", [join(staging, "profile.zip"), OUTPUT]);
  rmSync(staging, { recursive: true, force: true });

  console.log(`built ${OUTPUT}`);
}

build();
