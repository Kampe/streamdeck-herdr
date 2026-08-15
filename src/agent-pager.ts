export type AgentPageListener = () => void;

/** Shared page state for every paged agent key in the active profile. */
export class AgentPager {
  readonly pageSize: number;
  readonly #listeners = new Set<AgentPageListener>();
  #page = 0;

  constructor(pageSize = 8) {
    if (!Number.isInteger(pageSize) || pageSize < 1) {
      throw new RangeError("pageSize must be a positive integer");
    }
    this.pageSize = pageSize;
  }

  get page(): number {
    return this.#page;
  }

  pageCount(agentCount: number): number {
    return Math.max(1, Math.ceil(Math.max(0, agentCount) / this.pageSize));
  }

  absoluteIndex(slot: number): number {
    return this.#page * this.pageSize + slot;
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
