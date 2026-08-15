import streamDeck, {
  action,
  SingletonAction,
  type KeyAction,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";

import { ACTION_UUID_HEALTH } from "../constants.js";
import type { HerdrStore, HerdrState } from "../herdr/store.js";
import type { QuotaStore } from "../quota/store.js";

@action({ UUID: ACTION_UUID_HEALTH })
export class Health extends SingletonAction<Record<string, never>> {
  readonly #keys = new Map<string, { key: KeyAction<Record<string, never>>; unsubscribe: () => void }>();
  constructor(private readonly store: HerdrStore, private readonly quota?: QuotaStore) { super(); }

  override onWillAppear(ev: WillAppearEvent<Record<string, never>>): void {
    if (!ev.action.isKey()) return;
    const key = ev.action;
    const unsubscribeStore = this.store.subscribe((state) => void this.#render(key, state));
    const unsubscribeQuota = this.quota?.subscribe(() => {
      const state = this.store.state;
      void this.#render(key, state);
    });
    const entry = { key, unsubscribe: () => { unsubscribeStore(); unsubscribeQuota?.(); } };
    this.#keys.set(ev.action.id, entry);
  }

  override onWillDisappear(ev: WillDisappearEvent<Record<string, never>>): void {
    this.#keys.get(ev.action.id)?.unsubscribe();
    this.#keys.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<Record<string, never>>): Promise<void> {
    try {
      await this.store.request("ping");
      await ev.action.showOk();
    } catch (error) {
      streamDeck.logger.warn("Herdr health check failed", error);
      await ev.action.showAlert();
    }
  }

  async #render(key: KeyAction<Record<string, never>>, state: HerdrState): Promise<void> {
    if (state.status === "offline") {
      await key.setTitle("Herdr\nOffline");
      return;
    }
    const counts = state.snapshot.agents.reduce<Record<string, number>>((result, agent) => {
      result[agent.status] = (result[agent.status] ?? 0) + 1;
      return result;
    }, {});
    const quotaState = this.quota?.started === true ? this.quota.state.status : undefined;
    const quotaLabel = quotaState === undefined ? "" : quotaState === "ready" ? "\nQuota OK" : quotaState === "error" ? "\nQuota !" : "\nQuota …";
    await key.setTitle(`Herdr OK\n${state.snapshot.agents.length} agents\n${counts.blocked ?? 0} blocked${quotaLabel}`);
  }
}
