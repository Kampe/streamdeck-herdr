import streamDeck, {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";

import { ACTION_UUID_QUOTA } from "../constants.js";
import { renderQuotaKey } from "../quota/render.js";
import type { QuotaStore } from "../quota/store.js";
import type { QuotaSettings } from "../settings.js";

type QuotaEntry = {
  key: KeyAction<QuotaSettings>;
  settings: QuotaSettings;
  unsubscribe: () => void;
};

@action({ UUID: ACTION_UUID_QUOTA })
export class Quota extends SingletonAction<QuotaSettings> {
  readonly #entries = new Map<string, QuotaEntry>();

  constructor(private readonly store: QuotaStore) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent<QuotaSettings>): void {
    if (!ev.action.isKey()) {
      return;
    }
    const entry: QuotaEntry = {
      key: ev.action,
      settings: ev.payload.settings,
      unsubscribe: () => {},
    };
    entry.unsubscribe = this.store.subscribe(() => void this.#render(entry));
    this.#entries.set(ev.action.id, entry);
  }

  override onWillDisappear(ev: WillDisappearEvent<QuotaSettings>): void {
    this.#entries.get(ev.action.id)?.unsubscribe();
    this.#entries.delete(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<QuotaSettings>): void {
    const entry = this.#entries.get(ev.action.id);
    if (entry === undefined) {
      return;
    }
    entry.settings = ev.payload.settings;
    void this.#render(entry);
  }

  override async onKeyDown(ev: KeyDownEvent<QuotaSettings>): Promise<void> {
    await this.store.refresh(true);
    if (this.store.state.status === "ready") {
      await ev.action.showOk();
    } else {
      streamDeck.logger.warn("Quota refresh failed", this.store.state);
      await ev.action.showAlert();
    }
  }

  async #render(entry: QuotaEntry): Promise<void> {
    const provider = entry.settings.provider ?? "codex";
    const pool = entry.settings.pool ?? "all";
    await entry.key.setTitle("");
    await entry.key.setImage(renderQuotaKey(this.store.state, provider, pool));
  }
}
