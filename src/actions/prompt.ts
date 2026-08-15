/**
 * プロンプト送信キー。定型のプロンプトを対象エージェントへ投入する。
 */

import streamDeck, { action } from "@elgato/streamdeck";

import { ACTION_UUID_PROMPT } from "../constants.js";
import type { PromptSettings } from "../settings.js";
import { TargetAction } from "./target-action.js";

const MACROS: Record<NonNullable<PromptSettings["macro"]>, string> = {
  continue: "Continue with the task. If blocked, explain exactly what you need.",
  review: "Review the current diff for correctness, regressions, and missing tests.",
  tests: "Run the relevant tests now. Fix failures you introduced and report the result.",
  explain: "Explain the current blocker, the evidence, and the smallest safe next step.",
  stop: "Stop after the current safe checkpoint and summarize what remains.",
  custom: "",
};

@action({ UUID: ACTION_UUID_PROMPT })
export class Prompt extends TargetAction<PromptSettings> {
  protected override defaultLabel(): string {
    return streamDeck.i18n.translate("Prompt");
  }

  protected override async perform(target: string, settings: PromptSettings): Promise<void> {
    const text = settings.macro !== undefined && settings.macro !== "custom"
      ? MACROS[settings.macro]
      : settings.text ?? "";
    if (text.trim() === "") {
      throw new Error(streamDeck.i18n.translate("No prompt is configured to send"));
    }
    // `wait` は指定しない。エージェントの応答完了まで待つとキーが固まるため。
    await this.store.request("agent.prompt", { target, text });
  }
}
