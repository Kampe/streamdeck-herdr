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
import { ACTION_UUID_AGENT_QUEUE } from "../constants.js";
import type { HerdrStore } from "../herdr/store.js";
import { bringITermToFront } from "../platform/foreground.js";
import type { AgentQueueSettings } from "../settings.js";
import { sortAgents } from "../herdr/target.js";

type Entry = { key: KeyAction<AgentQueueSettings>; settings: AgentQueueSettings; unsubscribe: () => void };

function queueImage(count: number, attention: boolean): string {
  const background = count === 0 ? "#17212b" : attention ? "#a61e2d" : "#147d64";
  const label = attention ? "!" : "•";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" rx="18" fill="${background}"/><text x="72" y="82" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="64" font-weight="700" fill="#fff">${label}</text><text x="72" y="123" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="24" font-weight="700" fill="#fff">${count}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

@action({ UUID: ACTION_UUID_AGENT_QUEUE })
export class AgentQueue extends SingletonAction<AgentQueueSettings> {
  readonly #entries = new Map<string, Entry>();
  constructor(private readonly store: HerdrStore, private readonly pager: AgentPager) { super(); }

  override onWillAppear(ev: WillAppearEvent<AgentQueueSettings>): void {
    if (!ev.action.isKey()) return;
    const entry: Entry = { key: ev.action, settings: ev.payload.settings, unsubscribe: () => {} };
    entry.unsubscribe = this.store.subscribe(() => void this.#render(entry));
    this.#entries.set(ev.action.id, entry);
  }

  override onWillDisappear(ev: WillDisappearEvent<AgentQueueSettings>): void {
    this.#entries.get(ev.action.id)?.unsubscribe();
    this.#entries.delete(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<AgentQueueSettings>): void {
    const entry = this.#entries.get(ev.action.id);
    if (entry === undefined) return;
    entry.settings = ev.payload.settings;
    void this.#render(entry);
  }

  override async onKeyDown(ev: KeyDownEvent<AgentQueueSettings>): Promise<void> {
    const snapshot = this.store.snapshot;
    if (snapshot === null) {
      await ev.action.showAlert();
      return;
    }
    const mode = ev.payload.settings.queue === "idle" ? "idle" : "attention";
    this.pager.setView({ mode });
    const agents = mode === "idle"
      ? sortAgents(snapshot).filter((agent) => agent.status === "idle")
      : sortAgents(snapshot).filter((agent) => agent.status === "blocked" || agent.status === "done" || agent.status === "unknown");
    const target = agents.find((agent) => !agent.focused) ?? agents[0];
    if (target === undefined) {
      await ev.action.showAlert();
      return;
    }
    try {
      await this.store.request("agent.focus", { target: target.paneId });
      await bringITermToFront();
      await ev.action.showOk();
    } catch (error) {
      streamDeck.logger.error("Agent queue focus failed", error);
      await ev.action.showAlert();
    }
  }

  async #render(entry: Entry): Promise<void> {
    const snapshot = this.store.snapshot;
    const mode = entry.settings.queue === "idle" ? "idle" : "attention";
    const count = snapshot === null ? 0 : mode === "idle"
      ? snapshot.agents.filter((agent) => agent.status === "idle").length
      : snapshot.agents.filter((agent) => agent.status === "blocked" || agent.status === "done" || agent.status === "unknown").length;
    await entry.key.setImage(queueImage(count, mode === "attention"));
    await entry.key.setTitle(`${mode === "idle" ? "Idle" : "Attention"}\n${count}`);
  }
}
