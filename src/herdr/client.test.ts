import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HerdrApiError, HerdrClient, HerdrConnectionError } from "./client.js";
import { FakeSocket } from "./fake-socket.js";

const SOCKET_PATH = "/tmp/fake-herdr.sock";

/** 接続済みのクライアントとフェイクソケットを用意する。 */
async function connected(
  options: Partial<{
    onEvent: (event: string, data: unknown) => void;
    onClose: (error: Error | null) => void;
  }> = {},
): Promise<{ client: HerdrClient; socket: FakeSocket }> {
  const socket = new FakeSocket();
  const client = new HerdrClient({
    socketPath: SOCKET_PATH,
    createSocket: () => socket,
    ...options,
  });
  const connecting = client.connect();
  socket.open();
  await connecting;
  return { client, socket };
}

/** 直近のリクエストの `id` を取り出す。 */
function lastRequestId(socket: FakeSocket): string {
  const messages = socket.sentMessages() as { id: string }[];
  const last = messages[messages.length - 1];
  if (last === undefined) {
    throw new Error("リクエストが送信されていません");
  }
  return last.id;
}

describe("HerdrClient.connect", () => {
  it("渡されたソケットパスで接続する", async () => {
    const socket = new FakeSocket();
    const createSocket = vi.fn(() => socket);
    const client = new HerdrClient({ socketPath: SOCKET_PATH, createSocket });

    const connecting = client.connect();
    socket.open();
    await connecting;

    expect(createSocket).toHaveBeenCalledWith(SOCKET_PATH);
    expect(client.isOpen).toBe(true);
  });

  it("herdr が起動していない場合は HerdrConnectionError で棄却する", async () => {
    const socket = new FakeSocket();
    const client = new HerdrClient({ socketPath: SOCKET_PATH, createSocket: () => socket });

    const connecting = client.connect();
    socket.fail(new Error("ENOENT"));

    await expect(connecting).rejects.toBeInstanceOf(HerdrConnectionError);
    expect(client.isOpen).toBe(false);
  });
});

describe("HerdrClient.request", () => {
  it("id で応答を対応づけ、並行リクエストが混線しない", async () => {
    const { client, socket } = await connected();

    const first = client.request("session.snapshot");
    const second = client.request("agent.list");
    const [firstId, secondId] = (socket.sentMessages() as { id: string }[]).map(
      (message) => message.id,
    );

    socket.receiveMessage({ id: secondId, result: { agents: [] } });
    socket.receiveMessage({ id: firstId, result: { snapshot: {} } });

    await expect(first).resolves.toEqual({ snapshot: {} });
    await expect(second).resolves.toEqual({ agents: [] });
  });

  it("method と params をそのまま送る", async () => {
    const { client, socket } = await connected();

    void client.request("agent.focus", { target: "wE:p1" });

    expect(socket.sentMessages()[0]).toEqual({
      id: expect.any(String),
      method: "agent.focus",
      params: { target: "wE:p1" },
    });
  });

  it("error 応答は code を保った HerdrApiError になる", async () => {
    const { client, socket } = await connected();

    const request = client.request("agent.focus", { target: "wZ:p9" });
    socket.receiveMessage({
      id: lastRequestId(socket),
      error: { code: "agent_not_found", message: "agent target wZ:p9 not found" },
    });

    await expect(request).rejects.toMatchObject({
      name: "HerdrApiError",
      code: "agent_not_found",
    });
    await expect(request).rejects.toBeInstanceOf(HerdrApiError);
  });

  it("未接続なら送信せずに棄却する", async () => {
    const socket = new FakeSocket();
    const client = new HerdrClient({ socketPath: SOCKET_PATH, createSocket: () => socket });

    await expect(client.request("ping")).rejects.toBeInstanceOf(HerdrConnectionError);
    expect(socket.written).toEqual([]);
  });

  it("切断すると未解決のリクエストが HerdrConnectionError で棄却される", async () => {
    const { client, socket } = await connected();

    const request = client.request("session.snapshot");
    socket.fail(new Error("EPIPE"));

    await expect(request).rejects.toBeInstanceOf(HerdrConnectionError);
    expect(client.isOpen).toBe(false);
  });
});

describe("HerdrClient のメッセージ復元", () => {
  it("1 つの chunk に複数行が来ても分解する", async () => {
    const { client, socket } = await connected();

    const first = client.request("ping");
    const second = client.request("ping");
    const ids = (socket.sentMessages() as { id: string }[]).map((message) => message.id);
    socket.receive(
      `${JSON.stringify({ id: ids[0], result: 1 })}\n${JSON.stringify({ id: ids[1], result: 2 })}\n`,
    );

    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
  });

  it("1 行が複数 chunk に分割されても復元する", async () => {
    const { client, socket } = await connected();

    const request = client.request("ping");
    const line = JSON.stringify({ id: lastRequestId(socket), result: { type: "pong" } });
    socket.receive(line.slice(0, 7));
    socket.receive(line.slice(7));
    socket.receive("\n");

    await expect(request).resolves.toEqual({ type: "pong" });
  });

  it("壊れた行が来ても後続のメッセージを処理できる", async () => {
    const { client, socket } = await connected();

    const request = client.request("ping");
    socket.receive("{ これは JSON ではない\n");
    socket.receiveMessage({ id: lastRequestId(socket), result: "ok" });

    await expect(request).resolves.toBe("ok");
  });
});

describe("HerdrClient.subscribe", () => {
  it("購読の type を配列で送り、以後のイベントを onEvent へ渡す", async () => {
    const onEvent = vi.fn();
    const { client, socket } = await connected({ onEvent });

    const subscribing = client.subscribe(["pane.updated", "workspace.closed"]);
    socket.receiveMessage({
      id: lastRequestId(socket),
      result: { type: "subscription_started" },
    });
    await subscribing;

    expect(socket.sentMessages()[0]).toMatchObject({
      method: "events.subscribe",
      params: { subscriptions: [{ type: "pane.updated" }, { type: "workspace.closed" }] },
    });

    socket.receiveMessage({ event: "pane_updated", data: { pane_id: "wE:p1" } });

    expect(onEvent).toHaveBeenCalledWith("pane_updated", { pane_id: "wE:p1" });
  });
});

describe("HerdrClient のタイムアウトと切断通知", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("応答が来なければタイムアウトで棄却する", async () => {
    const socket = new FakeSocket();
    const client = new HerdrClient({
      socketPath: SOCKET_PATH,
      createSocket: () => socket,
      requestTimeoutMs: 1_000,
    });
    const connecting = client.connect();
    socket.open();
    await connecting;

    // タイマーを進める前に棄却を受け取っておく（未処理の rejection にしないため）。
    const settled = client.request("session.snapshot").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(settled).resolves.toBeInstanceOf(HerdrConnectionError);
  });

  it("意図しない切断は onClose で通知する", async () => {
    const onClose = vi.fn();
    const { socket } = await connected({ onClose });

    socket.fail(new Error("EPIPE"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("自分で close() したときは onClose を呼ばない", async () => {
    const onClose = vi.fn();
    const { client, socket } = await connected({ onClose });

    client.close();

    expect(socket.destroyed).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});
