import streamDeck, {
  action,
  SingletonAction,
  type KeyDownEvent,
  type KeyUpEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";

import {
  ACTION_UUID_PANE_CLOSE,
  ACTION_UUID_PANE_SPLIT,
  ACTION_UUID_PANE_SWAP,
} from "../constants.js";
import { paneControlRequest, type PaneControl } from "../herdr/pane-controls.js";
import type { HerdrStore } from "../herdr/store.js";

type PaneControlSettings = Record<string, never>;
const LONG_PRESS_MS = 600;

abstract class PaneControlAction extends SingletonAction<PaneControlSettings> {
  readonly #pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly store: HerdrStore,
    private readonly labelKey: string,
    private readonly tapControl: PaneControl | null,
    private readonly holdControl: PaneControl | null,
  ) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent<PaneControlSettings>): void {
    void ev.action.setTitle(streamDeck.i18n.translate(this.labelKey));
  }

  override async onKeyDown(ev: KeyDownEvent<PaneControlSettings>): Promise<void> {
    if (this.holdControl === null) {
      if (this.tapControl !== null) {
        await this.#run(this.tapControl, ev);
      }
      return;
    }

    const timeout = setTimeout(() => {
      this.#pending.delete(ev.action.id);
      void this.#run(this.holdControl!, ev);
    }, LONG_PRESS_MS);
    this.#pending.set(ev.action.id, timeout);
  }

  override onWillDisappear(ev: WillDisappearEvent<PaneControlSettings>): void {
    const pending = this.#pending.get(ev.action.id);
    if (pending !== undefined) {
      clearTimeout(pending);
      this.#pending.delete(ev.action.id);
    }
  }

  override async onKeyUp(ev: KeyUpEvent<PaneControlSettings>): Promise<void> {
    const timeout = this.#pending.get(ev.action.id);
    if (timeout === undefined) {
      return;
    }
    clearTimeout(timeout);
    this.#pending.delete(ev.action.id);
    if (this.tapControl !== null) {
      await this.#run(this.tapControl, ev);
    }
  }

  async #run(
    control: PaneControl,
    ev: KeyDownEvent<PaneControlSettings> | KeyUpEvent<PaneControlSettings>,
  ): Promise<void> {
    const paneId = this.store.snapshot?.focusedPaneId;
    if (paneId === undefined || paneId === null) {
      await ev.action.showAlert();
      return;
    }

    const request = paneControlRequest(control, paneId);
    try {
      await this.store.request(request.method, request.params);
      await ev.action.showOk();
    } catch (error) {
      streamDeck.logger.error(`Herdr pane control failed: ${control}`, error);
      await ev.action.showAlert();
    }
  }
}

/** Tap to split right; hold to split down. */
@action({ UUID: ACTION_UUID_PANE_SPLIT })
export class SplitPane extends PaneControlAction {
  constructor(store: HerdrStore) {
    super(store, "Split", "split-right", "split-down");
  }
}

/** Tap to swap right; hold to swap down. */
@action({ UUID: ACTION_UUID_PANE_SWAP })
export class SwapPane extends PaneControlAction {
  constructor(store: HerdrStore) {
    super(store, "Swap", "swap-right", "swap-down");
  }
}

/** Closing is hold-only so a stray tap cannot destroy a live pane. */
@action({ UUID: ACTION_UUID_PANE_CLOSE })
export class ClosePane extends PaneControlAction {
  constructor(store: HerdrStore) {
    super(store, "Hold Close", null, "close");
  }
}
