/**
 * 中断キー。対象エージェントに Esc を送って実行を止める。
 */

import { action } from "@elgato/streamdeck";

import { ACTION_UUID_INTERRUPT } from "../constants.js";
import { resolveKeys } from "../herdr/keys.js";
import type { InterruptSettings } from "../settings.js";
import { TargetAction } from "./target-action.js";

@action({ UUID: ACTION_UUID_INTERRUPT })
export class Interrupt extends TargetAction<InterruptSettings> {
  protected override defaultLabel(): string {
    return "中断";
  }

  protected override async perform(target: string): Promise<void> {
    await this.store.request("agent.send_keys", { target, keys: resolveKeys("reject", undefined) });
  }
}
