import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HerdrConnectionError } from "./client.js";
import { FakeSocket } from "./fake-socket.js";
import { HerdrStore, type HerdrState } from "./store.js";

/** `session.snapshot` の応答 1 件分。`label` で世代を見分ける。 */
function snapshotResult(label: string): unknown {
  return {
    type: "session_snapshot",
    snapshot: {
      focused_pane_id: "wE:p1",
      agents: [
        {
          pane_id: "wE:p1",
          workspace_id: "wE",
          tab_id: "wE:t1",
          agent: "claude",
          agent_status: "working",
          terminal_title_stripped: label,
        },
      ],
      workspaces: [{ workspace_id: "wE", label: "example", number: 1 }],
    },
  };
}

type SentRequest = { id: string; method: string; params: Record<string, unknown> };

/**
 * リクエストに自動応答するフェイクソケット。
 * herdr と同じく、購読以外は応答したら接続を閉じる。
 */
class ScriptedSocket extends FakeSocket {
  readonly requests: SentRequest[] = [];
  method = "";

  constructor(private readonly server: FakeHerdrServer) {
    super();
  }

  override write(data: string): boolean {
    super.write(data);
    for (const line of data.split("\n").filter((part) => part !== "")) {
      const request = JSON.parse(line) as SentRequest;
      this.requests.push(request);
      this.method = request.method;
      this.server.record(request.method);
      queueMicrotask(() => this.#respond(request));
    }
    return true;
  }

  #respond(request: SentRequest): void {
    if (request.method === "events.subscribe") {
      this.receiveMessage({ id: request.id, result: { type: "subscription_started" } });
      return;
    }
    const result =
      request.method === "session.snapshot"
        ? snapshotResult(this.server.nextSnapshotLabel())
        : { type: "ok" };
    this.receiveMessage({ id: request.id, result });
    // herdr は応答後に接続を閉じる。
    this.destroy();
  }
}

/** 生成されたソケットとリクエスト回数を記録する。 */
class FakeHerdrServer {
  readonly sockets: ScriptedSocket[] = [];
  readonly methodCounts = new Map<string, number>();
  snapshotLabels = ["初回"];

  createSocket = (): ScriptedSocket => {
    const socket = new ScriptedSocket(this);
    this.sockets.push(socket);
    queueMicrotask(() => socket.open());
    return socket;
  };

  record(method: string): void {
    this.methodCounts.set(method, (this.methodCounts.get(method) ?? 0) + 1);
  }

  countOf(method: string): number {
    return this.methodCounts.get(method) ?? 0;
  }

  /** 購読中の（＝まだ閉じていない）ソケット。 */
  streamSocket(): ScriptedSocket | undefined {
    return this.sockets.find(
      (socket) => socket.method === "events.subscribe" && !socket.destroyed,
    );
  }

  nextSnapshotLabel(): string {
    const index = Math.min(this.countOf("session.snapshot") - 1, this.snapshotLabels.length - 1);
    return this.snapshotLabels[index] ?? "初回";
  }
}

/** 保留中のマイクロタスクを掃き出す。 */
async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) {
    await Promise.resolve();
  }
}

describe("HerdrStore", () => {
  let server: FakeHerdrServer;
  let store: HerdrStore;

  beforeEach(() => {
    vi.useFakeTimers();
    server = new FakeHerdrServer();
    store = new HerdrStore({
      socketPath: "/tmp/fake-herdr.sock",
      createSocket: server.createSocket,
      reconnectIntervalMs: 2_000,
      refreshDebounceMs: 150,
      refreshMinIntervalMs: 1_000,
    });
  });

  afterEach(() => {
    store.stop();
    vi.useRealTimers();
  });

  it("購読を張ってからスナップショットを取得する", async () => {
    store.start();
    await flush();

    expect(server.countOf("events.subscribe")).toBe(1);
    expect(server.countOf("session.snapshot")).toBe(1);
    expect(store.state.status).toBe("online");
    expect(store.snapshot?.agents[0]?.paneId).toBe("wE:p1");
  });

  it("購読の接続は開いたまま、リクエストの接続は閉じる", async () => {
    store.start();
    await flush();

    const subscribeSocket = server.sockets.find((s) => s.method === "events.subscribe");
    const snapshotSocket = server.sockets.find((s) => s.method === "session.snapshot");

    expect(subscribeSocket?.destroyed).toBe(false);
    expect(snapshotSocket?.destroyed).toBe(true);
  });

  it("購読すると登録直後に現在の状態が 1 回渡る", async () => {
    store.start();
    await flush();

    const states: HerdrState[] = [];
    store.subscribe((state) => states.push(state));

    expect(states).toHaveLength(1);
    expect(states[0]?.status).toBe("online");
  });

  it("短時間に届いたイベントは 1 回の再取得にまとまる", async () => {
    store.start();
    await flush();
    server.snapshotLabels = ["初回", "2 回目"];

    const stream = server.streamSocket();
    for (let index = 0; index < 5; index += 1) {
      stream?.receiveMessage({ event: "pane_updated", data: { pane_id: "wE:p1" } });
    }
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();

    expect(server.countOf("session.snapshot")).toBe(2);
    expect(store.snapshot?.agents[0]?.title).toBe("2 回目");
  });

  it("イベントが鳴り続けても最短間隔より高い頻度では取得しない", async () => {
    store.start();
    await flush();
    const stream = server.streamSocket();

    // エージェントが出力している間 pane.updated は絶え間なく飛ぶ。
    for (let elapsed = 0; elapsed < 3_000; elapsed += 100) {
      stream?.receiveMessage({ event: "pane_updated", data: { pane_id: "wE:p1" } });
      await vi.advanceTimersByTimeAsync(100);
      await flush();
    }

    // 初回 + 3 秒間で 3 回程度。デバウンスだけなら 20 回になる。
    expect(server.countOf("session.snapshot")).toBeLessThanOrEqual(4);
    expect(server.countOf("session.snapshot")).toBeGreaterThan(1);
  });

  it("見た目に効く変化が無ければ購読者に通知しない", async () => {
    store.start();
    await flush();
    const listener = vi.fn();
    store.subscribe(listener);
    listener.mockClear();

    server.streamSocket()?.receiveMessage({ event: "pane_updated", data: { pane_id: "wE:p1" } });
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();

    expect(server.countOf("session.snapshot")).toBe(2);
    expect(listener).not.toHaveBeenCalled();
  });

  it("エージェントの状態が変われば通知する", async () => {
    store.start();
    await flush();
    const listener = vi.fn();
    store.subscribe(listener);
    listener.mockClear();
    server.snapshotLabels = ["初回", "2 回目"];

    server.streamSocket()?.receiveMessage({ event: "pane_updated", data: { pane_id: "wE:p1" } });
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("購読が切れると購読者にオフラインが通知され、2 秒後に再接続する", async () => {
    store.start();
    await flush();
    const states: HerdrState[] = [];
    store.subscribe((state) => states.push(state));

    server.streamSocket()?.fail(new Error("EPIPE"));
    await flush();

    expect(store.state.status).toBe("offline");
    expect(states.at(-1)?.status).toBe("offline");

    await vi.advanceTimersByTimeAsync(2_000);
    await flush();

    expect(server.countOf("events.subscribe")).toBe(2);
    expect(store.state.status).toBe("online");
  });

  it("オフラインの間はリクエストを送らずに例外を投げる", async () => {
    store.start();
    await flush();
    server.streamSocket()?.fail(new Error("EPIPE"));
    await flush();
    const before = server.sockets.length;

    await expect(store.request("agent.focus", { target: "wE:p1" })).rejects.toBeInstanceOf(
      HerdrConnectionError,
    );
    expect(server.sockets).toHaveLength(before);
  });

  it("購読を解除した後は通知が飛ばない", async () => {
    store.start();
    await flush();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    listener.mockClear();

    unsubscribe();
    server.streamSocket()?.fail(new Error("EPIPE"));
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it("stop() すると再接続しない", async () => {
    store.start();
    await flush();

    store.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();

    expect(server.countOf("events.subscribe")).toBe(1);
    expect(store.state.status).toBe("offline");
  });
});
