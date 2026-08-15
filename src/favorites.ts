export type FavoritesListener = (favorites: ReadonlySet<string>) => void;

/** Small in-memory mirror of the persisted Stream Deck global favorite list. */
export class FavoritesStore {
  readonly #listeners = new Set<FavoritesListener>();
  #ids = new Set<string>();

  constructor(ids: readonly string[] = []) {
    this.#ids = new Set(ids.filter((id) => id.length > 0));
  }

  get ids(): ReadonlySet<string> {
    return this.#ids;
  }

  has(id: string): boolean {
    return this.#ids.has(id);
  }

  toggle(id: string): boolean {
    if (this.#ids.has(id)) this.#ids.delete(id);
    else this.#ids.add(id);
    this.#notify();
    return this.#ids.has(id);
  }

  replace(ids: readonly string[]): void {
    this.#ids = new Set(ids.filter((id) => id.length > 0));
    this.#notify();
  }

  subscribe(listener: FavoritesListener): () => void {
    this.#listeners.add(listener);
    listener(this.#ids);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener(this.#ids);
  }
}
