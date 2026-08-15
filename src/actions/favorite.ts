import streamDeck, {
  action,
  SingletonAction,
  type KeyDownEvent,
  type WillAppearEvent,
} from "@elgato/streamdeck";

import { ACTION_UUID_FAVORITE } from "../constants.js";
import type { FavoritesStore } from "../favorites.js";
import type { HerdrStore } from "../herdr/store.js";

@action({ UUID: ACTION_UUID_FAVORITE })
export class Favorite extends SingletonAction<Record<string, never>> {
  constructor(private readonly store: HerdrStore, private readonly favorites: FavoritesStore, private readonly persist: (ids: string[]) => Promise<void>) { super(); }

  override onWillAppear(ev: WillAppearEvent<Record<string, never>>): void {
    void ev.action.setTitle("Favorite");
  }

  override async onKeyDown(ev: KeyDownEvent<Record<string, never>>): Promise<void> {
    const agent = this.store.snapshot?.agents.find((item) => item.paneId === this.store.snapshot?.focusedPaneId);
    if (agent?.sessionId === null || agent?.sessionId === undefined) {
      await ev.action.showAlert();
      return;
    }
    const active = this.favorites.toggle(agent.sessionId);
    await this.persist([...this.favorites.ids]);
    await ev.action.setTitle(active ? "Pinned" : "Favorite");
    await ev.action.showOk();
    streamDeck.logger.info(`favorite ${active ? "added" : "removed"}`);
  }
}

