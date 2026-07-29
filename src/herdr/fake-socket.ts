/**
 * テスト用のフェイクソケット。
 *
 * 実際の Unix ドメインソケットを開かずに、接続・受信・切断を手で起こせるようにする。
 * 本番コードからは参照しない（`plugin.ts` から辿れないためバンドルにも入らない）。
 */

import { EventEmitter } from "node:events";

import type { SocketLike } from "./socket.js";

export class FakeSocket extends EventEmitter implements SocketLike {
  /** `write()` された生の文字列。改行を含む。 */
  readonly written: string[] = [];
  destroyed = false;

  write(data: string): boolean {
    this.written.push(data);
    return true;
  }

  destroy(): this {
    if (!this.destroyed) {
      this.destroyed = true;
      this.emit("close");
    }
    return this;
  }

  /** 接続確立を起こす。 */
  open(): void {
    this.emit("connect");
  }

  /** 任意のバイト列の到着を起こす。行の途中で切って渡せる。 */
  receive(text: string): void {
    this.emit("data", Buffer.from(text, "utf8"));
  }

  /** JSON 1 件を 1 行として到着させる。 */
  receiveMessage(value: unknown): void {
    this.receive(`${JSON.stringify(value)}\n`);
  }

  /** 通信エラーによる切断を起こす。 */
  fail(error: Error): void {
    this.emit("error", error);
  }

  /** `write()` された行を JSON として読み出す。 */
  sentMessages(): unknown[] {
    return this.written
      .join("")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as unknown);
  }
}
