/**
 * herdr ソケット API のクライアント。
 *
 * リクエストと応答を `id` で対応づけ、`error` 応答を型付きの例外に変える。
 * イベントは購読ハンドラへ素通しする。再接続は行わず、切断は `onClose` で
 * 上位（store.ts）へ伝えるだけにとどめる。
 */

import { REQUEST_TIMEOUT_MS } from "../constants.js";
import { createUnixSocket, JsonLineConnection, type SocketFactory } from "./socket.js";

/** herdr が `error` 応答を返した。`code` は herdr のエラーコード。 */
export class HerdrApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HerdrApiError";
    this.code = code;
  }
}

/** 接続していない・接続が切れた・応答が来ない。 */
export class HerdrConnectionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HerdrConnectionError";
  }
}

export type HerdrClientOptions = {
  socketPath: string;
  /** テストでフェイクに差し替えるための注入点。 */
  createSocket?: SocketFactory;
  /** 購読中に流れてくるイベント。 */
  onEvent?: (event: string, data: unknown) => void;
  /** 接続が閉じた。未解決のリクエストはこの前にすべて reject される。 */
  onClose?: (error: Error | null) => void;
  requestTimeoutMs?: number;
};

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class HerdrClient {
  readonly #options: HerdrClientOptions;
  readonly #createSocket: SocketFactory;
  readonly #requestTimeoutMs: number;
  readonly #pending = new Map<string, PendingRequest>();
  #connection: JsonLineConnection | null = null;
  #open = false;
  #closing = false;
  #nextId = 0;

  constructor(options: HerdrClientOptions) {
    this.#options = options;
    this.#createSocket = options.createSocket ?? createUnixSocket;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  /**
   * 接続する。確立したら解決し、確立前に閉じたら `HerdrConnectionError` で棄却する。
   * herdr が起動していない場合はソケットファイルが無く、`error` 経由でここに来る。
   */
  connect(): Promise<void> {
    this.#closing = false;
    return new Promise((resolve, reject) => {
      let settled = false;

      const connection = new JsonLineConnection(this.#createSocket(this.#options.socketPath), {
        onOpen: () => {
          this.#open = true;
          settled = true;
          resolve();
        },
        onMessage: (message) => {
          if (message.kind === "event") {
            this.#options.onEvent?.(message.event, message.data);
            return;
          }
          const pending = this.#pending.get(message.id);
          if (pending === undefined) {
            return;
          }
          this.#pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.kind === "error") {
            pending.reject(new HerdrApiError(message.code, message.message));
          } else {
            pending.resolve(message.result);
          }
        },
        onClose: (error) => {
          this.#open = false;
          this.#connection = null;
          this.#rejectAllPending(error);
          if (!settled) {
            settled = true;
            reject(new HerdrConnectionError("herdr に接続できません", { cause: error ?? undefined }));
            return;
          }
          if (!this.#closing) {
            this.#options.onClose?.(error);
          }
        },
      });

      this.#connection = connection;
    });
  }

  /**
   * メソッドを呼び、`result` を返す。応答が `error` なら `HerdrApiError` を投げる。
   */
  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const connection = this.#connection;
    if (connection === null || !this.#open) {
      return Promise.reject(new HerdrConnectionError("herdr に接続していません"));
    }

    const id = `sd-${++this.#nextId}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new HerdrConnectionError(`herdr が ${method} に応答しません`));
      }, this.#requestTimeoutMs);

      this.#pending.set(id, { resolve, reject, timer });
      connection.send({ id, method, params });
    });
  }

  /** イベントを購読する。以後、同じ接続に `onEvent` が流れ続ける。 */
  async subscribe(types: readonly string[]): Promise<void> {
    await this.request("events.subscribe", {
      subscriptions: types.map((type) => ({ type })),
    });
  }

  /** 接続を閉じる。`onClose` は呼ばれない（意図した切断のため）。 */
  close(): void {
    this.#closing = true;
    const connection = this.#connection;
    this.#connection = null;
    this.#open = false;
    this.#rejectAllPending(null);
    connection?.close();
  }

  #rejectAllPending(cause: Error | null): void {
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const request of pending) {
      clearTimeout(request.timer);
      request.reject(
        new HerdrConnectionError("herdr との接続が切れました", { cause: cause ?? undefined }),
      );
    }
  }
}
