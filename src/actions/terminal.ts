import streamDeck, { action, SingletonAction, type KeyDownEvent, type WillAppearEvent } from "@elgato/streamdeck";

import { ACTION_UUID_TERMINAL } from "../constants.js";
import { bringTerminalToFront } from "../platform/foreground.js";
import type { TerminalSettings } from "../settings.js";

@action({ UUID: ACTION_UUID_TERMINAL })
export class Terminal extends SingletonAction<TerminalSettings> {
  override onWillAppear(ev: WillAppearEvent<TerminalSettings>): void {
    void ev.action.setTitle(ev.payload.settings.app ?? "Terminal");
  }

  override async onKeyDown(ev: KeyDownEvent<TerminalSettings>): Promise<void> {
    const ok = await bringTerminalToFront(ev.payload.settings.app ?? "iTerm2", ev.payload.settings.match ?? "herdr");
    if (!ok) {
      streamDeck.logger.warn("Terminal foreground handoff unavailable");
      await ev.action.showAlert();
    }
  }
}
