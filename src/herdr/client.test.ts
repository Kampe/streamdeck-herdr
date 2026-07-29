import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HerdrApiError, HerdrClient, HerdrConnectionError } from "./client.js";
import { FakeSocket } from "./fake-socket.js";

const SOCKET_PATH = "/tmp/fake-herdr.sock";

/** 生成されたソケットを記録するファクトリ。 */
function collector(): { sockets: FakeSocket[]; createSocket: () => FakeSocket } {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  };
}

function client(createSocket: () => FakeSocket, requestTimeoutMs = 5_000): HerdrClient {
  return new HerdrClient({ socketPath: SOCKET_PATH, createSocket, requestTimeoutMs });
}

/** 直近のソケットに送られたメッセージ。 */
function sent(socket: FakeSocket): Record<string, unknown>[] {
  return socket.sentMessages() as Record<string, unknown>[];
}

describe("HerdrClient.request", () => {
  it("リクエストごとに接続を開き、応答を受け取ったら閉じる", async () => {
    const { sockets, createSocket } = collector();

    const first = client(createSocket).request("agent.focus", { target: "wE:p1" });
    sockets[0]?.open();
    await Promise.resolve();
    sockets[0]?.receiveMessage({ id: sent(sockets[0]!)[0]?.id, result: { type: "ok" } });

    await expect(first).resolves.toEqual({ type: "ok" });
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.destroyed).toBe(true);
  });

  it("method と params をそのまま送る", async () => {
    const { sockets, createSocket } = collector();

    void client(createSocket).request("agent.send_keys", { target: "wE:p1", keys: ["esc"] });
    sockets[0]?.open();

    expect(sent(sockets[0]!)[0]).toEqual({
      id: expect.any(String),
      method: "agent.send_keys",
      params: { target: "wE:p1", keys: ["esc"] },
    });
  });

  it("2 回呼ぶと接続も 2 本開く", async () => {
    const { sockets, createSocket } = collector();
    const herdr = client(createSocket);

    void herdr.request("ping");
    void herdr.request("ping");

    expect(sockets).toHaveLength(2);
  });

  it("error 応答は code を保った HerdrApiError になる", async () => {
    const { sockets, createSocket } = collector();

    const request = client(createSocket).request("agent.focus", { target: "wZ:p9" });
    sockets[0]?.open();
    sockets[0]?.receiveMessage({
      id: sent(sockets[0]!)[0]?.id,
      error: { code: "agent_not_found", message: "agent target wZ:p9 not found" },
    });

    await expect(request).rejects.toBeInstanceOf(HerdrApiError);
    await expect(request).rejects.toMatchObject({ code: "agent_not_found" });
  });

  it("応答の前に切断されたら HerdrConnectionError になる", async () => {
    const { sockets, createSocket } = collector();

    const request = client(createSocket).request("session.snapshot");
    sockets[0]?.open();
    sockets[0]?.fail(new Error("EPIPE"));

    await expect(request).rejects.toBeInstanceOf(HerdrConnectionError);
  });

  it("herdr が起動していなければ HerdrConnectionError になる", async () => {
    const request = new HerdrClient({
      socketPath: SOCKET_PATH,
      createSocket: () => {
        throw new Error("ENOENT");
      },
    }).request("ping");

    await expect(request).rejects.toBeInstanceOf(HerdrConnectionError);
  });
});

describe("HerdrClient のメッセージ復元", () => {
  it("1 行が複数 chunk に分割されても復元する", async () => {
    const { sockets, createSocket } = collector();

    const request = client(createSocket).request("ping");
    sockets[0]?.open();
    const line = JSON.stringify({ id: sent(sockets[0]!)[0]?.id, result: { type: "pong" } });
    sockets[0]?.receive(line.slice(0, 7));
    sockets[0]?.receive(line.slice(7));
    sockets[0]?.receive("\n");

    await expect(request).resolves.toEqual({ type: "pong" });
  });

  it("壊れた行が来ても後続のメッセージを処理できる", async () => {
    const { sockets, createSocket } = collector();

    const request = client(createSocket).request("ping");
    sockets[0]?.open();
    sockets[0]?.receive("{ これは JSON ではない\n");
    sockets[0]?.receiveMessage({ id: sent(sockets[0]!)[0]?.id, result: "ok" });

    await expect(request).resolves.toBe("ok");
  });
});

describe("HerdrClient.openEventStream", () => {
  /** 購読が確立した状態のストリームとソケットを用意する。 */
  async function subscribed(onEvent = vi.fn(), onClose = vi.fn()) {
    const { sockets, createSocket } = collector();
    const opening = client(createSocket).openEventStream([{ type: "pane.updated" }], { onEvent, onClose });
    const socket = sockets[0];
    if (socket === undefined) {
      throw new Error("ソケットが生成されていません");
    }
    socket.open();
    await Promise.resolve();
    socket.receiveMessage({
      id: sent(socket)[0]?.id,
      result: { type: "subscription_started" },
    });
    return { stream: await opening, socket, onEvent, onClose };
  }

  it("購読の type を配列で送り、確立後も接続を保つ", async () => {
    const { socket } = await subscribed();

    expect(sent(socket)[0]).toMatchObject({
      method: "events.subscribe",
      params: { subscriptions: [{ type: "pane.updated" }] },
    });
    expect(socket.destroyed).toBe(false);
  });

  it("確立後のイベントを onEvent へ渡す", async () => {
    const { socket, onEvent } = await subscribed();

    socket.receiveMessage({ event: "pane_updated", data: { pane_id: "wE:p1" } });

    expect(onEvent).toHaveBeenCalledWith("pane_updated", { pane_id: "wE:p1" });
  });

  it("確立前に切断されたら棄却する", async () => {
    const { sockets, createSocket } = collector();

    const opening = client(createSocket).openEventStream([{ type: "pane.updated" }], {
      onEvent: vi.fn(),
      onClose: vi.fn(),
    });
    sockets[0]?.open();
    sockets[0]?.fail(new Error("EPIPE"));

    await expect(opening).rejects.toBeInstanceOf(HerdrConnectionError);
  });

  it("意図しない切断は onClose で通知する", async () => {
    const { socket, onClose } = await subscribed();

    socket.fail(new Error("EPIPE"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("自分で close() したときは onClose を呼ばない", async () => {
    const { stream, socket, onClose } = await subscribed();

    stream.close();

    expect(socket.destroyed).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("HerdrClient のタイムアウト", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("応答が来なければタイムアウトで棄却し、接続を閉じる", async () => {
    const { sockets, createSocket } = collector();

    // タイマーを進める前に棄却を受け取っておく（未処理の rejection にしないため）。
    const settled = client(createSocket, 1_000)
      .request("session.snapshot")
      .catch((error: unknown) => error);
    sockets[0]?.open();
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(settled).resolves.toBeInstanceOf(HerdrConnectionError);
    expect(sockets[0]?.destroyed).toBe(true);
  });
});
