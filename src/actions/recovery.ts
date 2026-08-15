import streamDeck, {
  action,
  SingletonAction,
  type KeyDownEvent,
  type KeyUpEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";

import { ACTION_UUID_RECOVERY } from "../constants.js";
import type { HerdrStore } from "../herdr/store.js";
import { resolveTarget } from "../herdr/target.js";
import { bringITermToFront } from "../platform/foreground.js";
import type { RecoverySettings } from "../settings.js";

const RETRY_PROMPT = "Continue with the task. If blocked, explain exactly what you need.";
const RESTART_PROMPT = "Stop the current attempt, reassess the task, and retry from the current state. If blocked, explain exactly what you need.";

@action({ UUID: ACTION_UUID_RECOVERY })
export class Recovery extends SingletonAction<RecoverySettings> {
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private readonly store: HerdrStore) { super(); }

  override onWillAppear(ev: WillAppearEvent<RecoverySettings>): void {
    void ev.action.setTitle(ev.payload.settings.operation === "restart" ? "Restart" : "Retry");
  }

  override onWillDisappear(ev: WillDisappearEvent<RecoverySettings>): void {
    const timer = this.#timers.get(ev.action.id);
    if (timer !== undefined) clearTimeout(timer);
    this.#timers.delete(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent<RecoverySettings>): void {
    const timer = setTimeout(() => {
      this.#timers.delete(ev.action.id);
      void this.#run(ev);
    }, 600);
    this.#timers.set(ev.action.id, timer);
  }

  override onKeyUp(ev: KeyUpEvent<RecoverySettings>): void {
    const timer = this.#timers.get(ev.action.id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#timers.delete(ev.action.id);
    }
  }

  async #run(ev: KeyDownEvent<RecoverySettings>): Promise<void> {
    const target = resolveTarget(ev.payload.settings, this.store.snapshot, "focused");
    if (target === null) {
      await ev.action.showAlert();
      return;
    }
    const restart = ev.payload.settings.operation === "restart";
    try {
      if (restart) await this.store.request("agent.send_keys", { target, keys: ["esc"] });
      await this.store.request("agent.prompt", { target, text: restart ? RESTART_PROMPT : RETRY_PROMPT });
      await bringITermToFront();
      await ev.action.showOk();
    } catch (error) {
      streamDeck.logger.error("Herdr recovery failed", error);
      await ev.action.showAlert();
    }
  }
}
