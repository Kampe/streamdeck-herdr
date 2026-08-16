import {
  action,
  SingletonAction,
  type KeyAction,
  type KeyDownEvent,
  type KeyUpEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";

import type { AgentPager } from "../agent-pager.js";
import { ACTION_UUID_WORKSPACE_PAGE } from "../constants.js";
import type { HerdrStore } from "../herdr/store.js";

const HOLD_MS = 600;

@action({ UUID: ACTION_UUID_WORKSPACE_PAGE })
export class WorkspacePage extends SingletonAction<Record<string, never>> {
  readonly #keys = new Map<string, KeyAction<Record<string, never>>>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private readonly store: HerdrStore, private readonly pager: AgentPager) { super(); }

  override onWillAppear(ev: WillAppearEvent<Record<string, never>>): void {
    if (!ev.action.isKey()) return;
    this.#keys.set(ev.action.id, ev.action);
    void this.#render(ev.action);
  }

  override onWillDisappear(ev: WillDisappearEvent<Record<string, never>>): void {
    const timer = this.#timers.get(ev.action.id);
    if (timer !== undefined) clearTimeout(timer);
    this.#timers.delete(ev.action.id);
    this.#keys.delete(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent<Record<string, never>>): void {
    const timer = setTimeout(() => {
      this.#timers.delete(ev.action.id);
      this.#move(-1);
      void this.#render(ev.action);
    }, HOLD_MS);
    this.#timers.set(ev.action.id, timer);
  }

  override async onKeyUp(ev: KeyUpEvent<Record<string, never>>): Promise<void> {
    const timer = this.#timers.get(ev.action.id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.#timers.delete(ev.action.id);
    this.#move(1);
    await this.#render(ev.action);
  }

  #move(direction: 1 | -1): void {
    const snapshot = this.store.snapshot;
    if (snapshot === null) return;
    const workspaces = snapshot.workspaces.filter((workspace) => snapshot.agents.some((agent) => agent.workspaceId === workspace.workspaceId));
    if (workspaces.length === 0) return;
    const current = workspaces.findIndex((workspace) => workspace.workspaceId === this.pager.view.workspaceId);
    const next = (current + direction + workspaces.length) % workspaces.length;
    this.pager.setView({ mode: "workspace", workspaceId: workspaces[next]?.workspaceId });
  }

  async #render(key: KeyAction<Record<string, never>>): Promise<void> {
    const snapshot = this.store.snapshot;
    const workspace = snapshot?.workspaces.find((item) => item.workspaceId === this.pager.view.workspaceId);
    const count = snapshot === null ? 0 : this.pager.visibleAgents(snapshot).length;
    await key.setTitle(`${workspace?.label ?? "Workspace"}\n${count}`);
  }
}
