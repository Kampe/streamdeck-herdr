/**
 * herdr ソケット API のクライアント。
 *
 * herdr は 1 つの応答を返すと接続を閉じる（実測で確認）。よってリクエストは
 * 1 回ごとに接続を張り直し、イベント購読だけを長寿命の接続として保持する。
 * 再接続は行わず、購読接続が切れたことは `onClose` で上位（store.ts）へ伝える。
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

/** 接続できない・接続が切れた・応答が来ない。 */
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
  requestTimeoutMs?: number;
};

export type EventStreamHandlers = {
  onEvent: (event: string, data: unknown) => void;
  /** 購読接続が意図せず閉じた。`close()` で閉じた場合は呼ばれない。 */
  onClose: (error: Error | null) => void;
};

/** 購読中の接続。 */
export type HerdrEventStream = {
  close(): void;
};

/**
 * 購読 1 件。`type` のほか、ペイン単位のイベントでは `pane_id` を伴う。
 */
export type Subscription = { type: string; pane_id?: string };

const REQUEST_ID = "sd-request";
const SUBSCRIBE_ID = "sd-subscribe";

export class HerdrClient {
  readonly #socketPath: string;
  readonly #createSocket: SocketFactory;
  readonly #requestTimeoutMs: number;

  constructor(options: HerdrClientOptions) {
    this.#socketPath = options.socketPath;
    this.#createSocket = options.createSocket ?? createUnixSocket;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /**
   * メソッドを 1 回呼ぶ。専用の接続を開き、応答を受け取ったら閉じる。
   * 応答が `error` なら `HerdrApiError` を投げる。
   */
  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      let settled = false;
      let connection: JsonLineConnection | null = null;

      const finish = (action: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        connection?.close();
        action();
      };

      const timer = setTimeout(() => {
        finish(() => reject(new HerdrConnectionError(`herdr が ${method} に応答しません`)));
      }, this.#requestTimeoutMs);

      try {
        connection = new JsonLineConnection(this.#createSocket(this.#socketPath), {
          onOpen: () => connection?.send({ id: REQUEST_ID, method, params }),
          onMessage: (message) => {
            if (message.kind === "event" || message.id !== REQUEST_ID) {
              return;
            }
            if (message.kind === "error") {
              finish(() => reject(new HerdrApiError(message.code, message.message)));
            } else {
              finish(() => resolve(message.result));
            }
          },
          onClose: (error) => {
            finish(() =>
              reject(
                new HerdrConnectionError(`herdr が ${method} に応答する前に切断されました`, {
                  cause: error ?? undefined,
                }),
              ),
            );
          },
        });
      } catch (error) {
        finish(() =>
          reject(new HerdrConnectionError("herdr に接続できません", { cause: error })),
        );
      }
    });
  }

  /**
   * イベントを購読する。購読が確立したら解決し、以後は同じ接続に
   * イベントが流れ続ける。確立前に閉じた場合は棄却する。
   */
  openEventStream(
    subscriptions: readonly Subscription[],
    handlers: EventStreamHandlers,
  ): Promise<HerdrEventStream> {
    return new Promise<HerdrEventStream>((resolve, reject) => {
      let opened = false;
      let closedByUs = false;
      let connection: JsonLineConnection | null = null;

      const close = (): void => {
        closedByUs = true;
        connection?.close();
      };

      try {
        connection = new JsonLineConnection(this.#createSocket(this.#socketPath), {
          onOpen: () =>
            connection?.send({
              id: SUBSCRIBE_ID,
              method: "events.subscribe",
              params: { subscriptions },
            }),
          onMessage: (message) => {
            if (message.kind === "event") {
              handlers.onEvent(message.event, message.data);
              return;
            }
            if (message.id !== SUBSCRIBE_ID || opened) {
              return;
            }
            if (message.kind === "error") {
              close();
              reject(new HerdrApiError(message.code, message.message));
              return;
            }
            opened = true;
            resolve({ close });
          },
          onClose: (error) => {
            if (!opened) {
              reject(
                new HerdrConnectionError("herdr のイベント購読を開始できません", {
                  cause: error ?? undefined,
                }),
              );
              return;
            }
            if (!closedByUs) {
              handlers.onClose(error);
            }
          },
        });
      } catch (error) {
        reject(new HerdrConnectionError("herdr に接続できません", { cause: error }));
      }
    });
  }
}
