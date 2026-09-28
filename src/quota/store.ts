import { FETCHERS, type Fetcher } from "./providers.js";
import { providerPools, staleCopy, type ProviderQuota, type QuotaSnapshot } from "./snapshot.js";

export type { QuotaInfo, QuotaSnapshot } from "./snapshot.js";

/**
 * Quota comes straight from each tool's own provider (see providers.ts), the
 * way OpenUsage gets it. Two minutes between polls keeps well clear of the
 * usage endpoints' rate limits; a key press forces a refresh, debounced.
 */
const REFRESH_INTERVAL_MS = 120_000;
const FORCE_DEBOUNCE_MS = 15_000;
/** After a provider rate-limits us, leave it alone this long (herd polls it too). */
const RATE_LIMIT_BACKOFF_MS = 600_000;

export type QuotaState =
  | { status: "loading" }
  | { status: "ready"; snapshot: QuotaSnapshot }
  | { status: "error"; message: string };

export type QuotaListener = (state: QuotaState) => void;

export class QuotaStore {
  readonly #listeners = new Set<QuotaListener>();
  readonly #fetchers: Record<string, Fetcher>;
  readonly #now: () => number;
  #state: QuotaState = { status: "loading" };
  #providers: Record<string, ProviderQuota> = {};
  #timer: ReturnType<typeof setInterval> | null = null;
  #inFlight: Promise<void> | null = null;
  #lastLoad = Number.NEGATIVE_INFINITY;
  readonly #cooldownUntil = new Map<string, number>();
  #started = false;

  constructor(fetchers: Record<string, Fetcher> = FETCHERS, now: () => number = Date.now) {
    this.#fetchers = fetchers;
    this.#now = now;
  }

  get state(): QuotaState {
    return this.#state;
  }

  get started(): boolean {
    return this.#started;
  }

  subscribe(listener: QuotaListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  start(): void {
    if (this.#timer !== null) {
      return;
    }
    this.#started = true;
    void this.refresh();
    this.#timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  refresh(force = false): Promise<void> {
    if (this.#inFlight !== null) {
      return this.#inFlight;
    }
    if (force && this.#now() - this.#lastLoad < FORCE_DEBOUNCE_MS) {
      return Promise.resolve();
    }
    this.#inFlight = this.#load().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #load(): Promise<void> {
    this.#lastLoad = this.#now();
    const names = Object.keys(this.#fetchers);
    const results = await Promise.allSettled(
      names.map((name) =>
        (this.#cooldownUntil.get(name) ?? 0) > this.#now()
          ? Promise.reject(new Error(`${name}: rate limited, backing off`))
          : this.#fetchers[name](),
      ),
    );
    const errors: string[] = [];
    results.forEach((result, i) => {
      const name = names[i];
      if (result.status === "fulfilled" && result.value.length > 0) {
        this.#providers[name] = { stale: false, pools: providerPools(name, result.value, this.#now()) };
        return;
      }
      const message =
        result.status === "rejected"
          ? result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
          : `${name}: no usage windows reported`;
      errors.push(message);
      if (/rate limited$/.test(message)) {
        this.#cooldownUntil.set(name, this.#now() + RATE_LIMIT_BACKOFF_MS);
      }
      const previous = this.#providers[name];
      // Keep the last good numbers visible, flagged stale, rather than blanking the key.
      this.#providers[name] =
        previous !== undefined && Object.keys(previous.pools).length > 0
          ? staleCopy(previous, message)
          : { stale: true, error: message, pools: {} };
    });
    const anyData = Object.values(this.#providers).some((p) => Object.keys(p.pools).length > 0);
    this.#setState(
      anyData
        ? { status: "ready", snapshot: { generatedAt: new Date(this.#now()).toISOString(), providers: { ...this.#providers } } }
        : { status: "error", message: errors.join("; ") },
    );
  }

  #setState(state: QuotaState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener(state);
    }
  }
}
