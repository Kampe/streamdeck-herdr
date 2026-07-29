import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSocket } from "./fake-socket.js";
import { HerdrConnectionError } from "./client.js";
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

/** リクエストに自動応答するフェイクソケット。 */
class ScriptedSocket extends FakeSocket {
  readonly requests: SentRequest[] = [];
  /** `session.snapshot` に返す応答。1 件だけなら毎回それを返す。 */
  snapshotLabels: string[] = ["初回"];

  override write(data: string): boolean {
    super.write(data);
    for (const line of data.split("\n").filter((part) => part !== "")) {
      const request = JSON.parse(line) as SentRequest;
      this.requests.push(request);
      queueMicrotask(() => this.receiveMessage({ id: request.id, result: this.#resultFor(request) }));
    }
    return true;
  }

  countOf(method: string): number {
    return this.requests.filter((request) => request.method === method).length;
  }

  #resultFor(request: SentRequest): unknown {
    if (request.method !== "session.snapshot") {
      return { type: "ok" };
    }
    const index = Math.min(this.countOf("session.snapshot") - 1, this.snapshotLabels.length - 1);
    return snapshotResult(this.snapshotLabels[index] ?? "初回");
  }
}

/** 生成されたソケットを記録しつつ、確立を自動で起こすファクトリ。 */
function socketFactory(sockets: ScriptedSocket[]): () => ScriptedSocket {
  return () => {
    const socket = new ScriptedSocket();
    sockets.push(socket);
    queueMicrotask(() => socket.open());
    return socket;
  };
}

function createStore(sockets: ScriptedSocket[]): HerdrStore {
  return new HerdrStore({
    socketPath: "/tmp/fake-herdr.sock",
    createSocket: socketFactory(sockets),
    reconnectIntervalMs: 2_000,
    refreshDebounceMs: 150,
  });
}

/** 保留中のマイクロタスクを掃き出す。 */
async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) {
    await Promise.resolve();
  }
}

describe("HerdrStore", () => {
  let sockets: ScriptedSocket[];
  let store: HerdrStore;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    store = createStore(sockets);
  });

  afterEach(() => {
    store.stop();
    vi.useRealTimers();
  });

  it("起動時にスナップショットを 1 回取得してからイベントを購読する", async () => {
    store.start();
    await flush();

    const socket = sockets[0];
    expect(socket?.requests.map((request) => request.method)).toEqual([
      "session.snapshot",
      "events.subscribe",
    ]);
    expect(store.state.status).toBe("online");
    expect(store.snapshot?.agents[0]?.paneId).toBe("wE:p1");
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
    const socket = sockets[0];
    if (socket === undefined) {
      throw new Error("ソケットが生成されていません");
    }
    socket.snapshotLabels = ["初回", "2 回目"];

    for (let index = 0; index < 5; index += 1) {
      socket.receiveMessage({ event: "pane_updated", data: { pane_id: "wE:p1" } });
    }
    await vi.advanceTimersByTimeAsync(150);
    await flush();

    expect(socket.countOf("session.snapshot")).toBe(2);
    expect(store.snapshot?.agents[0]?.title).toBe("2 回目");
  });

  it("切断すると購読者にオフラインが通知され、2 秒後に再接続する", async () => {
    store.start();
    await flush();
    const states: HerdrState[] = [];
    store.subscribe((state) => states.push(state));

    sockets[0]?.fail(new Error("EPIPE"));
    await flush();

    expect(store.state.status).toBe("offline");
    expect(states.at(-1)?.status).toBe("offline");

    await vi.advanceTimersByTimeAsync(2_000);
    await flush();

    expect(sockets).toHaveLength(2);
    expect(store.state.status).toBe("online");
  });

  it("オフラインの間はリクエストを送らずに例外を投げる", async () => {
    store.start();
    await flush();
    sockets[0]?.fail(new Error("EPIPE"));
    await flush();

    await expect(store.request("agent.focus", { target: "wE:p1" })).rejects.toBeInstanceOf(
      HerdrConnectionError,
    );
  });

  it("購読を解除した後は通知が飛ばない", async () => {
    store.start();
    await flush();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    listener.mockClear();

    unsubscribe();
    sockets[0]?.fail(new Error("EPIPE"));
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it("stop() すると再接続しない", async () => {
    store.start();
    await flush();

    store.stop();
    sockets[0]?.fail(new Error("EPIPE"));
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();

    expect(sockets).toHaveLength(1);
    expect(store.state.status).toBe("offline");
  });
});
