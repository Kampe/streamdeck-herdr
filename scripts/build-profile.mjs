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

/** Stream Deck Neo のモデル識別子。 */
const DEVICE_MODEL = "20GBJ9901";

/** プロファイルの識別子。生成物を安定させるため固定値にする。 */
const PROFILE_ID = "7B7B4E8A-4C0B-4F7C-9E52-6C2A5F5E1A01";

const OUTPUT = "com.github.yuntan.herdr.sdPlugin/profiles/herdr-neo.streamDeckProfile";

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
  ["2,1", "send-keys", "キー送信", { binding: "focused", preset: "interrupt" }],
  ["3,1", "prompt", "プロンプト送信", { binding: "focused", text: "" }],
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

function build() {
  const staging = mkdtempSync(join(tmpdir(), "herdr-profile-"));
  const folder = `${PROFILE_ID}.sdProfile`;
  mkdirSync(join(staging, folder), { recursive: true });

  const actions = {};
  for (const [coordinates, actionName, name, settings] of KEYS) {
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
      DeviceModel: DEVICE_MODEL,
      InstalledByPluginUUID: PLUGIN_UUID,
      Name: "herdr",
      PreconfiguredName: "herdr",
      Version: "1.0",
    }),
  );

  rmSync(OUTPUT, { force: true });
  execFileSync("zip", ["-r", "-q", "-X", join(staging, "profile.zip"), folder], { cwd: staging });
  execFileSync("cp", [join(staging, "profile.zip"), OUTPUT]);
  rmSync(staging, { recursive: true, force: true });

  console.log(`built ${OUTPUT}`);
}

build();
