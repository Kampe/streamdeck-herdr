import streamDeck, {
  action,
  SingletonAction,
  type KeyAction,
  type KeyDownEvent,
  type KeyUpEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";

import type { AgentPager } from "../agent-pager.js";
import { ACTION_UUID_PAGE_NEXT, ACTION_UUID_PAGE_PREVIOUS } from "../constants.js";
import type { HerdrStore } from "../herdr/store.js";

type PageSettings = Record<string, never>;
type Direction = "previous" | "next";

abstract class PageNavigation extends SingletonAction<PageSettings> {
  readonly #keys = new Map<string, { key: KeyAction<PageSettings>; unsubscribe: () => void }>();
  readonly #pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly store: HerdrStore,
    private readonly pager: AgentPager,
    private readonly favorites: () => ReadonlySet<string>,
    private readonly tapDirection: Direction,
    private readonly holdDirection: Direction | null,
  ) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent<PageSettings>): void {
    if (!ev.action.isKey()) {
      return;
    }
    const key = ev.action;
    const render = (): void => void this.#render(key);
    const unsubscribePager = this.pager.subscribe(render);
    const unsubscribeStore = this.store.subscribe(render);
    this.#keys.set(key.id, {
      key,
      unsubscribe: () => {
        unsubscribePager();
        unsubscribeStore();
      },
    });
  }

  override onWillDisappear(ev: WillDisappearEvent<PageSettings>): void {
    const pending = this.#pending.get(ev.action.id);
    if (pending !== undefined) {
      clearTimeout(pending);
      this.#pending.delete(ev.action.id);
    }
    this.#keys.get(ev.action.id)?.unsubscribe();
    this.#keys.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<PageSettings>): Promise<void> {
    if (this.holdDirection === null) {
      await this.#navigate(this.tapDirection, ev);
      return;
    }
    const timeout = setTimeout(() => {
      this.#pending.delete(ev.action.id);
      void this.#navigate(this.holdDirection!, ev);
    }, 600);
    this.#pending.set(ev.action.id, timeout);
  }

  override async onKeyUp(ev: KeyUpEvent<PageSettings>): Promise<void> {
    const timeout = this.#pending.get(ev.action.id);
    if (timeout === undefined) {
      return;
    }
    clearTimeout(timeout);
    this.#pending.delete(ev.action.id);
    await this.#navigate(this.tapDirection, ev);
  }

  async #navigate(
    direction: Direction,
    ev: KeyDownEvent<PageSettings> | KeyUpEvent<PageSettings>,
  ): Promise<void> {
    const count = this.store.snapshot === null ? 0 : this.pager.visibleAgents(this.store.snapshot, this.favorites()).length;
    if (direction === "previous") {
      this.pager.previous(count);
    } else {
      this.pager.next(count);
    }
    streamDeck.logger.info(`agent page ${this.pager.page + 1}/${this.pager.pageCount(count)}`);
  }

  async #render(key: KeyAction<PageSettings>): Promise<void> {
    const count = this.store.snapshot === null ? 0 : this.pager.visibleAgents(this.store.snapshot, this.favorites()).length;
    await key.setTitle(`${this.pager.page + 1}/${this.pager.pageCount(count)}`);
  }
}

@action({ UUID: ACTION_UUID_PAGE_PREVIOUS })
export class PreviousAgentPage extends PageNavigation {
  constructor(store: HerdrStore, pager: AgentPager, favorites: () => ReadonlySet<string>) {
    super(store, pager, favorites, "previous", null);
  }
}

@action({ UUID: ACTION_UUID_PAGE_NEXT })
export class NextAgentPage extends PageNavigation {
  constructor(store: HerdrStore, pager: AgentPager, favorites: () => ReadonlySet<string>) {
    super(store, pager, favorites, "next", "previous");
  }
}
