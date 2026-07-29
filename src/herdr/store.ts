/**
 * herdr の状態をプラグイン内で 1 つだけ保持し、全アクションへ配信する。
 *
 * イベントの差分を自前で適用するのではなく、イベントを合図に
 * `session.snapshot` を取り直す（spec/herdr-control.md 5.1）。
 * 実体と状態がずれず、購読の張り替えも要らない。
 */

import {
  RECONNECT_INTERVAL_MS,
  SNAPSHOT_DEBOUNCE_MS,
  SUBSCRIPTION_TYPES,
} from "../constants.js";
import { HerdrClient, HerdrConnectionError } from "./client.js";
import type { SocketFactory } from "./socket.js";
import { parseSessionSnapshot, type SessionSnapshot } from "./types.js";

/** 現在 herdr に繋がっているかどうかと、繋がっていれば最新のスナップショット。 */
export type HerdrState =
  | { status: "offline"; reason: string }
  | { status: "online"; snapshot: SessionSnapshot };

export type HerdrStateListener = (state: HerdrState) => void;

export type HerdrStoreOptions = {
  socketPath: string;
  createSocket?: SocketFactory;
  reconnectIntervalMs?: number;
  refreshDebounceMs?: number;
  /** 詳細ログの出力先。ユーザー向けメッセージではない。 */
  log?: (message: string, error?: unknown) => void;
};

export class HerdrStore {
  readonly #options: HerdrStoreOptions;
  readonly #reconnectIntervalMs: number;
  readonly #refreshDebounceMs: number;
  readonly #listeners = new Set<HerdrStateListener>();
  #socketPath: string;
  #client: HerdrClient | null = null;
  #state: HerdrState = { status: "offline", reason: "herdr に接続していません" };
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #running = false;

  constructor(options: HerdrStoreOptions) {
    this.#options = options;
    this.#socketPath = options.socketPath;
    this.#reconnectIntervalMs = options.reconnectIntervalMs ?? RECONNECT_INTERVAL_MS;
    this.#refreshDebounceMs = options.refreshDebounceMs ?? SNAPSHOT_DEBOUNCE_MS;
  }

  get state(): HerdrState {
    return this.#state;
  }

  /** オンラインなら最新のスナップショット、オフラインなら null。 */
  get snapshot(): SessionSnapshot | null {
    return this.#state.status === "online" ? this.#state.snapshot : null;
  }

  /**
   * 状態変化を購読する。登録直後に現在の状態が 1 回渡る。
   * 返り値を呼ぶと解除され、以後は通知されない。
   */
  subscribe(listener: HerdrStateListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * 接続を開始する。キーが 1 つも表示されていなくても接続は維持する
   * （初回表示を待たせないため）。
   */
  start(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;
    void this.#connect();
  }

  /**
   * 接続先を差し替える。設定が変わったときだけ繋ぎ直す。
   * アクションは 1 度しか登録できないため、ストア自体は作り直さない。
   */
  setSocketPath(socketPath: string): void {
    if (socketPath === this.#socketPath) {
      return;
    }
    this.#socketPath = socketPath;
    if (this.#running) {
      this.stop();
      this.start();
    }
  }

  /** 接続を止め、タイマーをすべて解除する。 */
  stop(): void {
    this.#running = false;
    this.#clearTimers();
    this.#client?.close();
    this.#client = null;
    this.#setState({ status: "offline", reason: "herdr に接続していません" });
  }

  /**
   * herdr にリクエストを送る。オフラインなら送らずに例外を投げる
   * （接続が切れている間は API を叩かない: spec 8章「Always」）。
   */
  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const client = this.#client;
    if (client === null || !client.isOpen) {
      throw new HerdrConnectionError("herdr に接続していません");
    }
    return client.request(method, params);
  }

  async #connect(): Promise<void> {
    const client = new HerdrClient({
      socketPath: this.#socketPath,
      createSocket: this.#options.createSocket,
      onEvent: () => this.#scheduleRefresh(),
      onClose: (error) => this.#handleClose(error),
    });

    try {
      await client.connect();
      this.#client = client;
      const snapshot = await this.#fetchSnapshot(client);
      await client.subscribe(SUBSCRIPTION_TYPES);
      this.#setState({ status: "online", snapshot });
    } catch (error) {
      client.close();
      this.#client = null;
      this.#options.log?.("herdr への接続に失敗しました", error);
      this.#setState({ status: "offline", reason: "herdr に接続できません" });
      this.#scheduleReconnect();
    }
  }

  async #fetchSnapshot(client: HerdrClient): Promise<SessionSnapshot> {
    const result = await client.request("session.snapshot");
    const snapshot = parseSessionSnapshot(result);
    if (snapshot === null) {
      throw new TypeError("session.snapshot の応答を解釈できません");
    }
    return snapshot;
  }

  /**
   * イベントを合図にスナップショットを取り直す。連続して届くイベントは
   * 1 回の再取得にまとめる。
   */
  #scheduleRefresh(): void {
    if (this.#refreshTimer !== null) {
      return;
    }
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null;
      void this.#refresh();
    }, this.#refreshDebounceMs);
  }

  async #refresh(): Promise<void> {
    const client = this.#client;
    if (client === null || !client.isOpen) {
      return;
    }
    try {
      const snapshot = await this.#fetchSnapshot(client);
      this.#setState({ status: "online", snapshot });
    } catch (error) {
      // 切断なら onClose 側でオフラインに落ちる。ここでは記録だけして次のイベントを待つ。
      this.#options.log?.("スナップショットの再取得に失敗しました", error);
    }
  }

  #handleClose(error: Error | null): void {
    this.#client = null;
    this.#clearRefreshTimer();
    this.#options.log?.("herdr との接続が切れました", error);
    this.#setState({ status: "offline", reason: "herdr に接続できません" });
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (!this.#running || this.#reconnectTimer !== null) {
      return;
    }
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#connect();
    }, this.#reconnectIntervalMs);
  }

  #clearRefreshTimer(): void {
    if (this.#refreshTimer !== null) {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
    }
  }

  #clearTimers(): void {
    this.#clearRefreshTimer();
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  /** 状態は書き換えず、新しいオブジェクトへ差し替えてから通知する。 */
  #setState(next: HerdrState): void {
    this.#state = next;
    for (const listener of [...this.#listeners]) {
      listener(next);
    }
  }
}
