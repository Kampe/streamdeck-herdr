/**
 * Stream Deck Neo（4 列 × 2 段）用の既定プロファイルを生成する。
 *
 * `.streamDeckProfile` は `<UUID>.sdProfile/manifest.json` を固めた zip。
 * プラグインに同梱するプロファイルは、アプリ内部の V3 形式ではなく
 * 配布用の V1 形式（`Actions` を座標キーで並べ、`InstalledByPluginUUID` を持つ）で
 * 書く。手で作ると中身が読めないので、配置をこのスクリプトに書いて生成する。
 *
 *   npm run build:profile
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN_UUID = "com.github.yuntan.herdr";

const DEFAULT_PROMPT = "Continue with the task. If blocked, explain exactly what you need.";

/**
 * 上段はエージェント 1〜4、下段は承認 / 拒否 / 中断 / プロンプト。
 * 座標は `"列,段"`（0 始まり）。
 */
const pagedAgent = (index) => ["agent-slot", "Agent", { binding: "index", index, paged: true }];

const PROFILES = [
  {
    id: "7B7B4E8A-4C0B-4F7C-9E52-6C2A5F5E1A01",
    model: "20GBJ9901",
    output: "com.github.yuntan.herdr.sdPlugin/profiles/herdr-neo.streamDeckProfile",
    keys: [
      ["0,0", ...pagedAgent(1)],
      ["1,0", ...pagedAgent(2)],
      ["2,0", ...pagedAgent(3)],
      ["3,0", ...pagedAgent(4)],
      ["0,1", "page-previous", "Previous Agent Page", {}],
      ["1,1", "page-next", "Next Agent Page", {}],
      ["2,1", "send-keys", "Send Keys", { binding: "focused", preset: "approve" }],
      [
        "3,1",
        "prompt",
        "Send Prompt",
        { binding: "focused", label: "Continue", text: DEFAULT_PROMPT },
      ],
    ],
  },
  {
    id: "6C4BB1A7-9F8E-4D32-A31E-FA24D1575B02",
    model: "20GAA9902",
    output: "com.github.yuntan.herdr.sdPlugin/profiles/herdr-original.streamDeckProfile",
    keys: [
      ["0,0", ...pagedAgent(1)],
      ["1,0", ...pagedAgent(2)],
      ["2,0", ...pagedAgent(3)],
      ["3,0", ...pagedAgent(4)],
      ["4,0", ...pagedAgent(5)],
      ["0,1", ...pagedAgent(6)],
      ["1,1", ...pagedAgent(7)],
      ["2,1", ...pagedAgent(8)],
      ["3,1", "page-next", "Agent Page", {}],
      ["4,1", "pane-close", "Close Pane", {}],
      ["0,2", "send-keys", "Send Keys", { binding: "focused", preset: "approve" }],
      ["1,2", "send-keys", "Send Keys", { binding: "focused", preset: "interrupt" }],
      [
        "2,2",
        "prompt",
        "Send Prompt",
        { binding: "focused", label: "Continue", text: DEFAULT_PROMPT },
      ],
      ["3,2", "pane-split", "Split Pane", {}],
      ["4,2", "pane-swap", "Swap Pane", {}],
    ],
  },
];

/** タイトルはキー画像の下端に重ねる。manifest の States と揃えておく。 */
function state() {
  return {
    FFamily: "",
    FSize: "9",
    FStyle: "",
    FUnderline: "off",
    Image: "",
    Title: "",
    TitleAlignment: "bottom",
    TitleColor: "#ffffff",
    TitleShow: "",
  };
}

function build(profile) {
  const staging = mkdtempSync(join(tmpdir(), "herdr-profile-"));
  const folder = `${profile.id}.sdProfile`;
  mkdirSync(join(staging, folder), { recursive: true });

  const actions = {};
  for (const [coordinates, actionName, name, settings] of profile.keys) {
    actions[coordinates] = {
      Name: name,
      Settings: settings,
      State: 0,
      States: [state()],
      UUID: `${PLUGIN_UUID}.${actionName}`,
    };
  }

  writeFileSync(
    join(staging, folder, "manifest.json"),
    JSON.stringify({
      Actions: actions,
      DeviceModel: profile.model,
      InstalledByPluginUUID: PLUGIN_UUID,
      Name: "herdr",
      PreconfiguredName: "herdr",
      Version: "1.0",
    }),
  );

  rmSync(profile.output, { force: true });
  execFileSync("zip", ["-r", "-q", "-X", join(staging, "profile.zip"), folder], { cwd: staging });
  execFileSync("cp", [join(staging, "profile.zip"), profile.output]);
  rmSync(staging, { recursive: true, force: true });

  console.log(`built ${profile.output}`);
}

for (const profile of PROFILES) {
  build(profile);
}
