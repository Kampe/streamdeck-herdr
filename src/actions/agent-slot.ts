/**
 * エージェントキー。
 *
 * herdr のエージェント 1 つを 1 キーに割り当て、状態を色で表示し、
 * 押すとそのエージェントをフォーカスする（Codex Micro のエージェントキー相当）。
 */

import streamDeck, {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";

import type { AgentPager } from "../agent-pager.js";
import { ACTION_UUID_AGENT_SLOT } from "../constants.js";
import { resolveAgent } from "../herdr/target.js";
import type { HerdrStore } from "../herdr/store.js";
import { bringITermToFront } from "../platform/foreground.js";
import { renderAgentKey } from "../render/key-image.js";
import { resolveSlotTitle } from "../render/labels.js";
import type { AgentSlotSettings } from "../settings.js";
import type { AgentStatus } from "../herdr/types.js";

type SlotEntry = {
  key: KeyAction<AgentSlotSettings>;
  settings: AgentSlotSettings;
  unsubscribeStore: () => void;
  unsubscribePager: () => void;
  lastStatus?: AgentStatus;
  flashUntil?: number;
  flashTimer?: ReturnType<typeof setTimeout>;
};

@action({ UUID: ACTION_UUID_AGENT_SLOT })
export class AgentSlot extends SingletonAction<AgentSlotSettings> {
  readonly #store: HerdrStore;
  readonly #pager: AgentPager;
  readonly #favorites: () => ReadonlySet<string>;
  readonly #foreground: () => Promise<boolean>;
  /** 表示中のキー。`onWillDisappear` で必ず取り除く。 */
  readonly #entries = new Map<string, SlotEntry>();

  constructor(store: HerdrStore, pager: AgentPager, favorites: () => ReadonlySet<string> = () => new Set(), foreground: () => Promise<boolean> = bringITermToFront) {
    super();
    this.#store = store;
    this.#pager = pager;
    this.#favorites = favorites;
    this.#foreground = foreground;
  }

  override onWillAppear(ev: WillAppearEvent<AgentSlotSettings>): void {
    if (!ev.action.isKey()) {
      return;
    }

    const key = ev.action;
    const entry: SlotEntry = {
      key,
      settings: ev.payload.settings,
      unsubscribeStore: () => {},
      unsubscribePager: () => {},
    };
    entry.unsubscribeStore = this.#store.subscribe(() => void this.#render(entry));
    entry.unsubscribePager = this.#pager.subscribe(() => void this.#render(entry));
    this.#entries.set(key.id, entry);
  }

  override onWillDisappear(ev: WillDisappearEvent<AgentSlotSettings>): void {
    const entry = this.#entries.get(ev.action.id);
    if (entry === undefined) {
      return;
    }
    entry.unsubscribeStore();
    entry.unsubscribePager();
    if (entry.flashTimer !== undefined) clearTimeout(entry.flashTimer);
    this.#entries.delete(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<AgentSlotSettings>): void {
    const entry = this.#entries.get(ev.action.id);
    if (entry === undefined) {
      return;
    }
    entry.settings = ev.payload.settings;
    void this.#render(entry);
  }

  override async onKeyDown(ev: KeyDownEvent<AgentSlotSettings>): Promise<void> {
    const snapshot = this.#store.snapshot;
    const target = snapshot === null
      ? null
      : this.#resolveAgent(ev.payload.settings, snapshot)?.paneId ?? null;
    if (target === null) {
      await ev.action.showAlert();
      return;
    }

    try {
      await this.#store.request("agent.focus", { target });
      await this.#foreground();
    } catch (error) {
      streamDeck.logger.error("エージェントのフォーカスに失敗しました", error);
      await ev.action.showAlert();
    }
  }

  async #render(entry: SlotEntry): Promise<void> {
    const { key, settings } = entry;
    const effectiveSettings = this.#effectiveSettings(settings);
    const binding = settings.binding ?? "index";
    const slot = binding === "index" ? (effectiveSettings.index ?? 1) : undefined;
    const state = this.#store.state;

    if (state.status === "offline") {
      entry.lastStatus = undefined;
      await key.setImage(renderAgentKey({ kind: "offline" }));
      await key.setTitle("");
      return;
    }

    const agent = this.#resolveAgent(settings, state.snapshot);
    if (agent === null) {
      entry.lastStatus = undefined;
      await key.setImage(renderAgentKey({ kind: "empty", slot }));
      await key.setTitle(resolveSlotTitle(settings, null, state.snapshot));
      return;
    }

    const isNewCompletion = entry.lastStatus !== undefined && entry.lastStatus !== "done" && agent.status === "done";
    if (isNewCompletion) {
      entry.flashUntil = Date.now() + 900;
      if (entry.flashTimer !== undefined) clearTimeout(entry.flashTimer);
      entry.flashTimer = setTimeout(() => {
        entry.flashUntil = undefined;
        entry.flashTimer = undefined;
        void this.#render(entry);
      }, 920);
    }
    const flash = entry.flashUntil !== undefined && entry.flashUntil > Date.now();
    entry.lastStatus = agent.status;

    await key.setImage(
      renderAgentKey({
        kind: "agent",
        status: agent.status,
        agent: agent.agent,
        slot,
        focused: agent.focused,
        flash,
      }),
    );
    await key.setTitle(resolveSlotTitle(settings, agent, state.snapshot));
  }

  #effectiveSettings(settings: AgentSlotSettings): AgentSlotSettings {
    if (settings.paged !== true || (settings.binding ?? "index") !== "index") {
      return settings;
    }
    return { ...settings, index: this.#pager.absoluteIndex(settings.index ?? 1) };
  }

  #resolveAgent(settings: AgentSlotSettings, snapshot: NonNullable<HerdrStore["snapshot"]>) {
    if (settings.paged === true && (settings.binding ?? "index") === "index") {
      return this.#pager.visibleAgent(snapshot, settings.index ?? 1, this.#favorites());
    }
    return resolveAgent(settings, snapshot, "index");
  }
}
