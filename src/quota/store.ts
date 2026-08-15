import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REFRESH_INTERVAL_MS = 60_000;

export type QuotaInfo = {
  available: boolean;
  reason: string;
  stale: boolean;
  remaining: number | null;
  resetsIn: string;
  classification: string;
};

export type QuotaSnapshot = {
  generatedAt: string;
  providers: Record<string, { stale: boolean; pools: Record<string, QuotaInfo> }>;
};

export type QuotaState =
  | { status: "loading" }
  | { status: "ready"; snapshot: QuotaSnapshot }
  | { status: "error"; message: string };

export type QuotaListener = (state: QuotaState) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseQuotaSnapshot(value: unknown): QuotaSnapshot | null {
  if (!isRecord(value) || !isRecord(value.providers)) {
    return null;
  }

  const providers: QuotaSnapshot["providers"] = {};
  for (const [providerName, providerValue] of Object.entries(value.providers)) {
    if (!isRecord(providerValue) || !isRecord(providerValue.pools)) {
      continue;
    }
    const pools: Record<string, QuotaInfo> = {};
    for (const [poolName, poolValue] of Object.entries(providerValue.pools)) {
      if (!isRecord(poolValue)) {
        continue;
      }
      pools[poolName] = {
        available: poolValue.available === true,
        reason: typeof poolValue.reason === "string" ? poolValue.reason : "unknown",
        stale: poolValue.stale === true,
        remaining: typeof poolValue.remaining === "number" ? poolValue.remaining : null,
        resetsIn: typeof poolValue.resetsIn === "string" ? poolValue.resetsIn : "?",
        classification:
          typeof poolValue.class === "string" ? poolValue.class : "unknown",
      };
    }
    providers[providerName] = { stale: providerValue.stale === true, pools };
  }

  return {
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : "",
    providers,
  };
}

export class QuotaStore {
  readonly #listeners = new Set<QuotaListener>();
  #state: QuotaState = { status: "loading" };
  #timer: ReturnType<typeof setInterval> | null = null;
  #inFlight: Promise<void> | null = null;
  #binary: Promise<string> | null = null;
  #started = false;

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

  refresh(force = false): Promise<void> {
    if (this.#inFlight !== null) {
      return this.#inFlight;
    }
    this.#inFlight = this.#load(force).finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #load(force: boolean): Promise<void> {
    try {
      const binary = await (this.#binary ??= findQuotaBinary());
      const path = [join(homedir(), "bin"), "/usr/local/bin", "/opt/homebrew/bin", process.env.PATH]
        .filter((item): item is string => item !== undefined && item !== "")
        .join(":");
      const { stdout } = await execFileAsync(binary, force ? ["--json", "--force"] : ["--json"], {
        encoding: "utf8",
        env: { ...process.env, PATH: path },
        maxBuffer: 2 * 1024 * 1024,
        timeout: 30_000,
      });
      const snapshot = parseQuotaSnapshot(JSON.parse(stdout));
      if (snapshot === null) {
        throw new TypeError("herdr-quota returned an unsupported document");
      }
      this.#setState({ status: "ready", snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#setState({ status: "error", message });
    }
  }

  #setState(state: QuotaState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener(state);
    }
  }
}

async function findQuotaBinary(): Promise<string> {
  const candidates = [
    process.env.HERDR_QUOTA_BIN,
    join(homedir(), "bin", "herdr-quota"),
    "/usr/local/bin/herdr-quota",
    "/opt/homebrew/bin/herdr-quota",
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === "") {
      continue;
    }
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next portable install location.
    }
  }
  throw new Error("herdr-quota was not found");
}
