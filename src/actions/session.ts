import streamDeck, {
  action,
  SingletonAction,
  type KeyDownEvent,
  type WillAppearEvent,
} from "@elgato/streamdeck";
import { homedir } from "node:os";
import { join } from "node:path";

import { ACTION_UUID_SESSION } from "../constants.js";
import type { HerdrStore } from "../herdr/store.js";
import type { SessionSettings } from "../settings.js";

@action({ UUID: ACTION_UUID_SESSION })
export class Session extends SingletonAction<SessionSettings> {
  constructor(private readonly store: HerdrStore, private readonly persist: (name: string) => Promise<void>) { super(); }

  override onWillAppear(ev: WillAppearEvent<SessionSettings>): void {
    void ev.action.setTitle(ev.payload.settings.sessionName ?? "Session");
  }

  override async onKeyDown(ev: KeyDownEvent<SessionSettings>): Promise<void> {
    const name = ev.payload.settings.sessionName?.trim();
    if (name === undefined || name === "") {
      await ev.action.showAlert();
      return;
    }
    const socketPath = join(homedir(), ".config", "herdr", "sessions", name, "herdr.sock");
    this.store.setSocketPath(socketPath);
    await this.persist(name);
    streamDeck.logger.info(`Herdr session selected: ${name}`);
  }
}
