/**
 * herdr ソケットの低レベル層。
 *
 * JSONL（1 行 1 メッセージ）の枠組みだけを担当する。TCP と同じく Unix ドメイン
 * ソケットも到着単位が行と一致しないため、行の再結合はここで行う。
 * リクエストの対応づけや再接続は上位（client.ts / store.ts）の責務。
 */

import { createConnection } from "node:net";

import { parseHerdrMessage, type HerdrMessage } from "./types.js";

/**
 * `net.Socket` のうち本モジュールが使う部分。テストでフェイクに差し替えるために
 * 最小限へ絞ってある。
 */
export type SocketLike = {
  on(event: "connect", listener: () => void): unknown;
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  write(data: string): unknown;
  destroy(): unknown;
};

export type SocketFactory = (path: string) => SocketLike;

/** 本番で使うソケット生成。 */
export const createUnixSocket: SocketFactory = (path) => createConnection(path);

export type ConnectionHandlers = {
  /** 接続が確立した。 */
  onOpen(): void;
  /** 1 メッセージを受信した。解釈できなかった行はここに来ない。 */
  onMessage(message: HerdrMessage): void;
  /** 接続が閉じた。原因が分かる場合のみ `error` が入る。1 接続につき 1 回だけ呼ばれる。 */
  onClose(error: Error | null): void;
};

export class JsonLineConnection {
  readonly #socket: SocketLike;
  readonly #handlers: ConnectionHandlers;
  #buffer = "";
  #closeNotified = false;

  constructor(socket: SocketLike, handlers: ConnectionHandlers) {
    this.#socket = socket;
    this.#handlers = handlers;

    socket.on("connect", () => this.#handlers.onOpen());
    socket.on("data", (chunk) => this.#handleData(chunk));
    socket.on("error", (error) => this.#notifyClose(error));
    socket.on("close", () => this.#notifyClose(null));
  }

  /** 1 メッセージを送る。改行はここで付ける。 */
  send(value: unknown): void {
    this.#socket.write(`${JSON.stringify(value)}\n`);
  }

  /** 接続を閉じる。`onClose` は 1 回だけ呼ばれる。 */
  close(): void {
    this.#socket.destroy();
    this.#notifyClose(null);
  }

  #handleData(chunk: Buffer | string): void {
    this.#buffer += chunk.toString();

    let newlineIndex = this.#buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.#buffer.slice(0, newlineIndex);
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      this.#handleLine(line);
      newlineIndex = this.#buffer.indexOf("\n");
    }
  }

  /**
   * 1 行を解釈する。JSON として壊れている行や、応答にもイベントにも見えない行は
   * 読み飛ばす（1 行の破損で接続全体を落とさない）。
   */
  #handleLine(line: string): void {
    if (line.trim() === "") {
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }

    const message = parseHerdrMessage(value);
    if (message !== null) {
      this.#handlers.onMessage(message);
    }
  }

  #notifyClose(error: Error | null): void {
    if (this.#closeNotified) {
      return;
    }
    this.#closeNotified = true;
    this.#handlers.onClose(error);
  }
}
