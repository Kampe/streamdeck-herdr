/**
 * herdr の状態をプラグイン内で 1 つだけ保持し、全アクションへ配信する。
 *
 * イベントの差分を自前で適用するのではなく、イベントを合図に
 * `session.snapshot` を取り直す（spec/herdr-control.md 5.1）。
 * 接続の生死は購読接続で判断する。herdr は通常のリクエストでは応答後に
 * 接続を閉じるため、リクエストの成否では「今つながっているか」を測れない。
 */

import {
  AGENT_STATUS_EVENT,
  RECONNECT_INTERVAL_MS,
  SNAPSHOT_DEBOUNCE_MS,
  SNAPSHOT_MIN_INTERVAL_MS,
  STRUCTURE_SUBSCRIPTION_TYPES,
} from "../constants.js";
import {
  HerdrClient,
  HerdrConnectionError,
  type HerdrEventStream,
  type Subscription,
} from "./client.js";
import type { SocketFactory } from "./socket.js";
import { parseAgentStatusChange, parseSessionSnapshot, type SessionSnapshot } from "./types.js";

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
  refreshMinIntervalMs?: number;
  requestTimeoutMs?: number;
  /** 詳細ログの出力先。ユーザー向けメッセージではない。 */
  log?: (message: string, error?: unknown) => void;
};

const OFFLINE_IDLE: HerdrState = { status: "offline", reason: "herdr に接続していません" };
const OFFLINE_FAILED: HerdrState = { status: "offline", reason: "herdr に接続できません" };

/**
 * キーの見た目に効く部分だけを取り出した指紋。
 * ペインの revision やスクロール位置しか変わっていない更新で
 * 再描画しないために使う。
 */
function stateSignature(state: HerdrState): string {
  if (state.status === "offline") {
    return `offline:${state.reason}`;
  }
  const { agents, workspaces, focusedPaneId } = state.snapshot;
  return JSON.stringify([
    agents.map((agent) => [
      agent.paneId,
      agent.workspaceId,
      agent.agent,
      agent.sessionId,
      agent.status,
      agent.title,
    ]),
    workspaces.map((workspace) => [workspace.workspaceId, workspace.label, workspace.number]),
    focusedPaneId,
  ]);
}

/** 状態変化を購読すべきペイン（エージェントのいるペイン）。 */
function agentPaneIds(snapshot: SessionSnapshot): string[] {
  return snapshot.agents.map((agent) => agent.paneId).sort();
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export class HerdrStore {
  readonly #options: HerdrStoreOptions;
  readonly #reconnectIntervalMs: number;
  readonly #refreshDebounceMs: number;
  readonly #refreshMinIntervalMs: number;
  readonly #listeners = new Set<HerdrStateListener>();
  #socketPath: string;
  #client: HerdrClient;
  #stream: HerdrEventStream | null = null;
  /** いま `pane.agent_status_changed` を購読しているペイン。 */
  #subscribedPanes: string[] = [];
  #state: HerdrState = OFFLINE_IDLE;
  #signature = stateSignature(OFFLINE_IDLE);
  #lastFetchAt = 0;
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #running = false;

  constructor(options: HerdrStoreOptions) {
    this.#options = options;
    this.#socketPath = options.socketPath;
    this.#reconnectIntervalMs = options.reconnectIntervalMs ?? RECONNECT_INTERVAL_MS;
    this.#refreshDebounceMs = options.refreshDebounceMs ?? SNAPSHOT_DEBOUNCE_MS;
    this.#refreshMinIntervalMs = options.refreshMinIntervalMs ?? SNAPSHOT_MIN_INTERVAL_MS;
    this.#client = this.#createClient();
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
    this.#client = this.#createClient();
    if (this.#running) {
      this.stop();
      this.start();
    }
  }

  /** 接続を止め、タイマーをすべて解除する。 */
  stop(): void {
    this.#running = false;
    this.#clearTimers();
    this.#stream?.close();
    this.#stream = null;
    this.#subscribedPanes = [];
    this.#setState(OFFLINE_IDLE);
  }

  /**
   * herdr にリクエストを送る。オフラインなら送らずに例外を投げる
   * （接続が切れている間は API を叩かない: spec 8章「Always」）。
   */
  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.#stream === null) {
      throw new HerdrConnectionError("herdr に接続していません");
    }
    return this.#client.request(method, params);
  }

  #createClient(): HerdrClient {
    return new HerdrClient({
      socketPath: this.#socketPath,
      createSocket: this.#options.createSocket,
      requestTimeoutMs: this.#options.requestTimeoutMs,
    });
  }

  /**
   * 接続してイベントを購読する。
   *
   * ペイン単位の状態変化を購読するには先にペインの一覧が要るので、
   * スナップショットを取ってから購読を張る。購読が張られるまでの隙間に
   * 起きた変化を取りこぼさないよう、張った直後にもう 1 度取り直す。
   */
  async #connect(): Promise<void> {
    try {
      const initial = await this.#fetchSnapshot();
      this.#stream = await this.#openStream(initial);

      const snapshot = await this.#fetchSnapshot();
      this.#options.log?.(`herdr に接続しました: ${this.#socketPath}`);
      this.#setState({ status: "online", snapshot });
    } catch (error) {
      this.#stream?.close();
      this.#stream = null;
      this.#options.log?.(`herdr への接続に失敗しました: ${this.#socketPath}`, error);
      this.#setState(OFFLINE_FAILED);
      this.#scheduleReconnect();
    }
  }

  #openStream(snapshot: SessionSnapshot): Promise<HerdrEventStream> {
    this.#subscribedPanes = agentPaneIds(snapshot);
    const subscriptions: Subscription[] = [
      ...STRUCTURE_SUBSCRIPTION_TYPES.map((type) => ({ type })),
      ...this.#subscribedPanes.map((paneId) => ({
        type: AGENT_STATUS_EVENT,
        pane_id: paneId,
      })),
    ];

    return this.#client.openEventStream(subscriptions, {
      onEvent: (event, data) => this.#handleEvent(event, data),
      onClose: (error) => this.#handleClose(error),
    });
  }

  /**
   * エージェントの状態変化はイベントの中身をそのまま反映する。
   * スナップショットを取り直すより速く、取り直しの間隔にも縛られない。
   * それ以外（ペインやワークスペースの増減）は取り直しで拾う。
   */
  #handleEvent(event: string, data: unknown): void {
    if (event === AGENT_STATUS_EVENT) {
      this.#applyStatusChange(data);
      return;
    }
    this.#scheduleRefresh();
  }

  #applyStatusChange(data: unknown): void {
    const change = parseAgentStatusChange(data);
    const state = this.#state;
    if (change === null || state.status !== "online") {
      return;
    }

    this.#options.log?.(`${change.paneId} の状態が ${change.status} になりました`);
    const agents = state.snapshot.agents.map((agent) =>
      agent.paneId === change.paneId
        ? { ...agent, status: change.status, agent: change.agent ?? agent.agent }
        : agent,
    );
    this.#setState({ status: "online", snapshot: { ...state.snapshot, agents } });
  }

  /** エージェントのいるペインが入れ替わったら、購読を張り直す。 */
  async #resubscribe(snapshot: SessionSnapshot): Promise<void> {
    const previous = this.#stream;
    try {
      const stream = await this.#openStream(snapshot);
      previous?.close();
      this.#stream = stream;
    } catch (error) {
      this.#options.log?.("購読の張り直しに失敗しました", error);
    }
  }

  async #fetchSnapshot(): Promise<SessionSnapshot> {
    this.#lastFetchAt = Date.now();
    const result = await this.#client.request("session.snapshot");
    const snapshot = parseSessionSnapshot(result);
    if (snapshot === null) {
      throw new TypeError("session.snapshot の応答を解釈できません");
    }
    return snapshot;
  }

  /**
   * イベントを合図にスナップショットを取り直す。連続して届くイベントは
   * 1 回の再取得にまとめ、さらに最短間隔で頭打ちにする。
   * エージェントが出力している間 `pane.updated` は止まらないため、
   * デバウンスだけでは取得が延々と続いてしまう。
   */
  #scheduleRefresh(): void {
    if (this.#refreshTimer !== null) {
      return;
    }
    const sinceLastFetch = Date.now() - this.#lastFetchAt;
    const delay = Math.max(this.#refreshDebounceMs, this.#refreshMinIntervalMs - sinceLastFetch);
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null;
      void this.#refresh();
    }, delay);
  }

  async #refresh(): Promise<void> {
    if (this.#stream === null) {
      return;
    }
    try {
      const snapshot = await this.#fetchSnapshot();
      this.#setState({ status: "online", snapshot });
      if (!sameIds(agentPaneIds(snapshot), this.#subscribedPanes)) {
        await this.#resubscribe(snapshot);
      }
    } catch (error) {
      // 購読接続が生きている限りオフラインにはしない。次のイベントで取り直す。
      this.#options.log?.("スナップショットの再取得に失敗しました", error);
    }
  }

  #handleClose(error: Error | null): void {
    this.#stream = null;
    this.#clearRefreshTimer();
    this.#options.log?.("herdr との接続が切れました", error);
    this.#setState(OFFLINE_FAILED);
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

  /**
   * 状態は書き換えず、新しいオブジェクトへ差し替えてから通知する。
   * キーの見た目に効かない変化（ペインの revision など）では通知しない。
   */
  #setState(next: HerdrState): void {
    const signature = stateSignature(next);
    this.#state = next;
    if (signature === this.#signature) {
      return;
    }
    this.#signature = signature;
    for (const listener of [...this.#listeners]) {
      listener(next);
    }
  }
}
