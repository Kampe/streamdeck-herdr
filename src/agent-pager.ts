import { sortAgents } from "./herdr/target.js";
import type { AgentInfo, SessionSnapshot } from "./herdr/types.js";

export type AgentPageListener = () => void;

export type AgentViewMode = "fleet" | "attention" | "idle" | "favorites" | "workspace";
export type AgentView = { mode: AgentViewMode; workspaceId?: string };

/** Shared page state for every paged agent key in the active profile. */
export class AgentPager {
  readonly pageSize: number;
  readonly #listeners = new Set<AgentPageListener>();
  #page = 0;
  #view: AgentView = { mode: "fleet" };

  constructor(pageSize = 8) {
    if (!Number.isInteger(pageSize) || pageSize < 1) {
      throw new RangeError("pageSize must be a positive integer");
    }
    this.pageSize = pageSize;
  }

  get page(): number {
    return this.#page;
  }

  get view(): AgentView {
    return this.#view;
  }

  setView(view: AgentView): void {
    if (view.mode === this.#view.mode && view.workspaceId === this.#view.workspaceId) {
      return;
    }
    this.#view = view;
    this.#setPage(0);
    for (const listener of this.#listeners) listener();
  }

  visibleAgents(snapshot: SessionSnapshot, favorites: ReadonlySet<string> = new Set()): AgentInfo[] {
    const agents = sortAgents(snapshot);
    switch (this.#view.mode) {
      case "attention":
        return agents.filter((agent) => agent.status === "blocked" || agent.status === "done" || agent.status === "unknown");
      case "idle":
        return agents.filter((agent) => agent.status === "idle");
      case "favorites":
        return agents.filter((agent) => agent.sessionId !== null && favorites.has(agent.sessionId));
      case "workspace":
        return agents.filter((agent) => agent.workspaceId === this.#view.workspaceId);
      default:
        return agents;
    }
  }

  visibleAgent(snapshot: SessionSnapshot, slot: number, favorites: ReadonlySet<string> = new Set()): AgentInfo | null {
    return this.visibleAgents(snapshot, favorites)[this.absoluteIndex(slot) - 1] ?? null;
  }

  pageCount(agentCount: number): number {
    return Math.max(1, Math.ceil(Math.max(0, agentCount) / this.pageSize));
  }

  absoluteIndex(slot: number): number {
    return this.#page * this.pageSize + slot;
  }

  /** Show the page containing a one-based absolute agent index. */
  showAbsoluteIndex(index: number, agentCount: number): void {
    if (!Number.isInteger(index) || index < 1 || index > agentCount) {
      return;
    }
    this.#setPage(Math.floor((index - 1) / this.pageSize));
  }

  next(agentCount: number): void {
    this.#setPage((this.#page + 1) % this.pageCount(agentCount));
  }

  previous(agentCount: number): void {
    const count = this.pageCount(agentCount);
    this.#setPage((this.#page - 1 + count) % count);
  }

  clamp(agentCount: number): void {
    this.#setPage(Math.min(this.#page, this.pageCount(agentCount) - 1));
  }

  subscribe(listener: AgentPageListener): () => void {
    this.#listeners.add(listener);
    listener();
    return () => this.#listeners.delete(listener);
  }

  refresh(): void {
    for (const listener of this.#listeners) listener();
  }

  #setPage(page: number): void {
    if (page === this.#page) {
      return;
    }
    this.#page = page;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
