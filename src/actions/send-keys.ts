/**
 * キー送信キー。承認 / 拒否などのキー列を対象エージェントへ送る。
 */

import { action } from "@elgato/streamdeck";

import { ACTION_UUID_SEND_KEYS } from "../constants.js";
import { resolveKeys } from "../herdr/keys.js";
import type { KeyPreset, SendKeysSettings } from "../settings.js";
import { TargetAction } from "./target-action.js";

/** プリセットごとの既定タイトル。 */
const PRESET_LABELS: Record<KeyPreset, string> = {
  approve: "Approve",
  reject: "Reject",
  yes: "Yes",
  no: "No",
  interrupt: "Interrupt",
  custom: "Send Keys",
};

/** プリセットごとのキー画像。何を送るキーなのか一目で分かるようにする。 */
const PRESET_IMAGES: Record<KeyPreset, string> = {
  approve: "imgs/keys/send-approve",
  reject: "imgs/keys/send-reject",
  yes: "imgs/keys/send-yes",
  no: "imgs/keys/send-no",
  interrupt: "imgs/keys/interrupt",
  custom: "imgs/keys/send-custom",
};

@action({ UUID: ACTION_UUID_SEND_KEYS })
export class SendKeys extends TargetAction<SendKeysSettings> {
  protected override defaultLabel(): string {
    return PRESET_LABELS.approve;
  }

  protected override label(settings: SendKeysSettings): string {
    return settings.label ?? PRESET_LABELS[settings.preset ?? "approve"];
  }

  protected override image(settings: SendKeysSettings): string {
    return PRESET_IMAGES[settings.preset ?? "approve"];
  }

  protected override async perform(target: string, settings: SendKeysSettings): Promise<void> {
    const keys = resolveKeys(settings.preset, settings.keys);
    if (keys.length === 0) {
      throw new Error("No keys are configured to send");
    }
    await this.store.request("agent.send_keys", { target, keys });
  }
}
