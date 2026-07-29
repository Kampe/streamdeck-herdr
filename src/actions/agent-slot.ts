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

import { ACTION_UUID_AGENT_SLOT } from "../constants.js";
import { resolveAgent } from "../herdr/target.js";
import type { HerdrStore } from "../herdr/store.js";
import { renderAgentKey } from "../render/key-image.js";
import { resolveSlotTitle } from "../render/labels.js";
import type { AgentSlotSettings } from "../settings.js";

type SlotEntry = {
  key: KeyAction<AgentSlotSettings>;
  settings: AgentSlotSettings;
  unsubscribe: () => void;
};

@action({ UUID: ACTION_UUID_AGENT_SLOT })
export class AgentSlot extends SingletonAction<AgentSlotSettings> {
  readonly #store: HerdrStore;
  /** 表示中のキー。`onWillDisappear` で必ず取り除く。 */
  readonly #entries = new Map<string, SlotEntry>();

  constructor(store: HerdrStore) {
    super();
    this.#store = store;
  }

  override onWillAppear(ev: WillAppearEvent<AgentSlotSettings>): void {
    if (!ev.action.isKey()) {
      return;
    }

    const key = ev.action;
    const entry: SlotEntry = {
      key,
      settings: ev.payload.settings,
      unsubscribe: () => {},
    };
    entry.unsubscribe = this.#store.subscribe(() => void this.#render(entry));
    this.#entries.set(key.id, entry);
  }

  override onWillDisappear(ev: WillDisappearEvent<AgentSlotSettings>): void {
    const entry = this.#entries.get(ev.action.id);
    if (entry === undefined) {
      return;
    }
    entry.unsubscribe();
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
    const target = resolveAgent(ev.payload.settings, this.#store.snapshot, "index")?.paneId ?? null;
    if (target === null) {
      await ev.action.showAlert();
      return;
    }

    try {
      await this.#store.request("agent.focus", { target });
    } catch (error) {
      streamDeck.logger.error("エージェントのフォーカスに失敗しました", error);
      await ev.action.showAlert();
    }
  }

  async #render(entry: SlotEntry): Promise<void> {
    const { key, settings } = entry;
    const binding = settings.binding ?? "index";
    const slot = binding === "index" ? (settings.index ?? 1) : undefined;
    const state = this.#store.state;

    if (state.status === "offline") {
      await key.setImage(renderAgentKey({ kind: "offline" }));
      await key.setTitle("");
      return;
    }

    const agent = resolveAgent(settings, state.snapshot, "index");
    if (agent === null) {
      await key.setImage(renderAgentKey({ kind: "empty", slot }));
      await key.setTitle(resolveSlotTitle(settings, null, state.snapshot));
      return;
    }

    await key.setImage(
      renderAgentKey({ kind: "agent", status: agent.status, agent: agent.agent, slot }),
    );
    await key.setTitle(resolveSlotTitle(settings, agent, state.snapshot));
  }
}
