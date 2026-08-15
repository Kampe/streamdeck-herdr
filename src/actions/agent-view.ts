import {
  action,
  SingletonAction,
  type KeyAction,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";

import { type AgentPager, type AgentViewMode } from "../agent-pager.js";
import { ACTION_UUID_AGENT_VIEW } from "../constants.js";
import type { HerdrStore } from "../herdr/store.js";
import type { AgentViewSettings } from "../settings.js";

const MODES: AgentViewMode[] = ["fleet", "attention", "idle", "favorites", "workspace"];
const LABELS: Record<AgentViewMode, string> = {
  fleet: "Fleet",
  attention: "Attention",
  idle: "Idle",
  favorites: "Favorites",
  workspace: "Workspace",
};

@action({ UUID: ACTION_UUID_AGENT_VIEW })
export class AgentView extends SingletonAction<AgentViewSettings> {
  readonly #keys = new Map<string, { key: KeyAction<AgentViewSettings>; unsubscribe: () => void }>();
  constructor(private readonly store: HerdrStore, private readonly pager: AgentPager, private readonly favorites: () => ReadonlySet<string>) { super(); }

  override onWillAppear(ev: WillAppearEvent<AgentViewSettings>): void {
    if (!ev.action.isKey()) return;
    const key = ev.action;
    const render = (): void => void this.#render(key);
    const unsubscribeStore = this.store.subscribe(render);
    const unsubscribePager = this.pager.subscribe(render);
    this.#keys.set(key.id, { key, unsubscribe: () => { unsubscribeStore(); unsubscribePager(); } });
    void this.#render(key);
  }

  override onWillDisappear(ev: WillDisappearEvent<AgentViewSettings>): void {
    this.#keys.get(ev.action.id)?.unsubscribe();
    this.#keys.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<AgentViewSettings>): Promise<void> {
    const current = this.pager.view.mode;
    const next = MODES[(MODES.indexOf(current) + 1) % MODES.length];
    if (next === "workspace") {
      const snapshot = this.store.snapshot;
      const workspace = snapshot?.workspaces.find((item) => snapshot.agents.some((agent) => agent.workspaceId === item.workspaceId));
      this.pager.setView({ mode: "workspace", workspaceId: workspace?.workspaceId });
    } else {
      this.pager.setView({ mode: next });
    }
    await this.#render(ev.action);
    await ev.action.showOk();
  }

  async #render(key: KeyAction<AgentViewSettings>): Promise<void> {
    const mode = this.pager.view.mode;
    const snapshot = this.store.snapshot;
    const count = snapshot === null ? 0 : this.pager.visibleAgents(snapshot, this.favorites()).length;
    await key.setTitle(`${LABELS[mode]}\n${count}`);
  }
}
