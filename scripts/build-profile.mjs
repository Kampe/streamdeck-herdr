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

/** Profiles use zero-based `"column,row"` coordinates. */
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
      ["2,1", "quota", "Quota", { provider: "codex", pool: "all" }],
      [
        "3,1",
        "prompt",
        "Send Prompt",
        { binding: "focused", label: "Continue", text: DEFAULT_PROMPT },
      ],
    ],
  },
  {
    id: "4FD9F1F8-2351-42EA-A8A7-486AE5FB2BA9",
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
      ["4,1", "send-keys", "Send Keys", { binding: "focused", preset: "interrupt" }],
      ["0,2", "quota", "Quota", { provider: "claude", pool: "all" }],
      ["1,2", "quota", "Quota", { provider: "codex", pool: "all" }],
      ["2,2", "quota", "Quota", { provider: "antigravity", pool: "all" }],
      ["3,2", "quota", "Quota", { provider: "grok", pool: "all" }],
      [
        "4,2",
        "prompt",
        "Send Prompt",
        { binding: "focused", label: "Continue", text: DEFAULT_PROMPT },
      ],
    ],
  },
  {
    id: "6B9DD8B4-0D65-4EC7-9B0E-2E5BB8B584C0",
    model: "20GAA9902",
    output: "com.github.yuntan.herdr.sdPlugin/profiles/herdr-control.streamDeckProfile",
    keys: [
      ["0,0", ...pagedAgent(1)],
      ["1,0", ...pagedAgent(2)],
      ["2,0", ...pagedAgent(3)],
      ["3,0", ...pagedAgent(4)],
      ["4,0", ...pagedAgent(5)],
      ["0,1", ...pagedAgent(6)],
      ["1,1", ...pagedAgent(7)],
      ["2,1", ...pagedAgent(8)],
      ["3,1", "agent-view", "Agent View", {}],
      ["4,1", "workspace-page", "Workspace", {}],
      ["0,2", "agent-queue", "Attention", { queue: "attention" }],
      ["1,2", "agent-queue", "Idle", { queue: "idle" }],
      ["2,2", "favorite", "Favorite", {}],
      ["3,2", "health", "Health", {}],
      ["4,2", "terminal", "Terminal", { app: "iTerm2", match: "herdr" }],
    ],
  },
];

/** タイトルはキー画像の上端に重ねる。manifest の States と揃えておく。 */
function state() {
  return {
    FFamily: "",
    FSize: "12",
    FStyle: "",
    FUnderline: "off",
    Image: "",
    Title: "",
    TitleAlignment: "top",
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
