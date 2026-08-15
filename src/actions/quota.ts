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
import { resolveTarget } from "../herdr/target.js";
import type { HerdrStore } from "../herdr/store.js";
import { providerStandingOrder } from "../provider-prompt.js";
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

  constructor(private readonly store: QuotaStore, private readonly herdr: HerdrStore) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent<QuotaSettings>): void {
    if (!ev.action.isKey()) {
      return;
    }
    // Keep the core plugin Herdr-only. OpenUsage is touched only when a quota
    // action is actually present in the active profile.
    this.store.start();
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
    const provider = ev.payload.settings.provider ?? "codex";
    // Refresh display data, but do not make dispatch depend on OpenUsage being
    // healthy. The key's primary action is the provider-only standing order.
    await this.store.refresh(true);
    const target = resolveTarget({ binding: "focused" }, this.herdr.snapshot, "focused");
    if (target === null) {
      streamDeck.logger.warn("No focused agent is available for provider standing order");
      await ev.action.showAlert();
      return;
    }
    try {
      await this.herdr.request("agent.prompt", {
        target,
        text: providerStandingOrder(provider),
      });
      await ev.action.showOk();
    } catch (error) {
      streamDeck.logger.error("Provider standing order failed", error);
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
