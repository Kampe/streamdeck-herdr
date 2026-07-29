import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HerdrConnectionError } from "./client.js";
import { FakeSocket } from "./fake-socket.js";
import { HerdrStore, type HerdrState } from "./store.js";

type AgentSpec = { paneId: string; workspaceId: string; status: string; title: string };

const DEFAULT_AGENTS: AgentSpec[] = [
  { paneId: "wE:p1", workspaceId: "wE", status: "working", title: "初回" },
];

/** `session.snapshot` の応答 1 件分。 */
function snapshotResult(agents: AgentSpec[]): unknown {
  return {
    type: "session_snapshot",
    snapshot: {
      focused_pane_id: "wE:p1",
      agents: agents.map((agent) => ({
        pane_id: agent.paneId,
        workspace_id: agent.workspaceId,
        tab_id: `${agent.workspaceId}:t1`,
        agent: "claude",
        agent_status: agent.status,
        terminal_title_stripped: agent.title,
      })),
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
      this.server.record(request);
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
        ? snapshotResult(this.server.agents)
        : { type: "ok" };
    this.receiveMessage({ id: request.id, result });
    // herdr は応答後に接続を閉じる。
    this.destroy();
  }
}

/** 生成されたソケットとリクエストを記録する。 */
class FakeHerdrServer {
  readonly sockets: ScriptedSocket[] = [];
  readonly requests: SentRequest[] = [];
  agents: AgentSpec[] = [...DEFAULT_AGENTS];

  createSocket = (): ScriptedSocket => {
    const socket = new ScriptedSocket(this);
    this.sockets.push(socket);
    queueMicrotask(() => socket.open());
    return socket;
  };

  record(request: SentRequest): void {
    this.requests.push(request);
  }

  countOf(method: string): number {
    return this.requests.filter((request) => request.method === method).length;
  }

  /** 直近の購読リクエストで送った購読一覧。 */
  lastSubscriptions(): { type: string; pane_id?: string }[] {
    const subscribes = this.requests.filter((request) => request.method === "events.subscribe");
    const last = subscribes[subscribes.length - 1];
    return (last?.params.subscriptions ?? []) as { type: string; pane_id?: string }[];
  }

  /** 購読中の（＝まだ閉じていない）ソケット。 */
  streamSocket(): ScriptedSocket | undefined {
    return this.sockets.find(
      (socket) => socket.method === "events.subscribe" && !socket.destroyed,
    );
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

  it("スナップショットを取ってから購読を張り、もう 1 度取り直す", async () => {
    store.start();
    await flush();

    expect(server.requests.map((request) => request.method)).toEqual([
      "session.snapshot",
      "events.subscribe",
      "session.snapshot",
    ]);
    expect(store.state.status).toBe("online");
    expect(store.snapshot?.agents[0]?.paneId).toBe("wE:p1");
  });

  it("エージェントのいるペインごとに状態変化を購読する", async () => {
    store.start();
    await flush();

    expect(server.lastSubscriptions()).toContainEqual({
      type: "pane.agent_status_changed",
      pane_id: "wE:p1",
    });
  });

  it("出力のたびに飛ぶイベントは購読しない", async () => {
    store.start();
    await flush();

    const types = server.lastSubscriptions().map((subscription) => subscription.type);
    expect(types).not.toContain("pane.updated");
    expect(types).not.toContain("workspace.focused");
    expect(types).not.toContain("tab.focused");
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

  it("状態変化イベントはスナップショットを待たずに即座に反映する", async () => {
    store.start();
    await flush();
    const listener = vi.fn();
    store.subscribe(listener);
    listener.mockClear();
    const before = server.countOf("session.snapshot");

    server.streamSocket()?.receiveMessage({
      event: "pane.agent_status_changed",
      data: { pane_id: "wE:p1", agent_status: "blocked", agent: "claude" },
    });

    expect(store.snapshot?.agents[0]?.status).toBe("blocked");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(server.countOf("session.snapshot")).toBe(before);
  });

  it("知らないペインの状態変化は無視する", async () => {
    store.start();
    await flush();
    const listener = vi.fn();
    store.subscribe(listener);
    listener.mockClear();

    server.streamSocket()?.receiveMessage({
      event: "pane.agent_status_changed",
      data: { pane_id: "wZ:p9", agent_status: "blocked" },
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("構成の変化イベントは最短間隔でまとめて取り直す", async () => {
    store.start();
    await flush();
    const before = server.countOf("session.snapshot");

    const stream = server.streamSocket();
    for (let elapsed = 0; elapsed < 3_000; elapsed += 100) {
      stream?.receiveMessage({ event: "pane_created", data: { pane_id: "wE:p2" } });
      await vi.advanceTimersByTimeAsync(100);
      await flush();
    }

    // 3 秒で 3 回程度。デバウンスだけなら 20 回を超える。
    expect(server.countOf("session.snapshot") - before).toBeLessThanOrEqual(4);
    expect(server.countOf("session.snapshot") - before).toBeGreaterThan(0);
  });

  it("見た目に効く変化が無ければ購読者に通知しない", async () => {
    store.start();
    await flush();
    const listener = vi.fn();
    store.subscribe(listener);
    listener.mockClear();

    server.streamSocket()?.receiveMessage({ event: "pane_created", data: {} });
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();

    expect(listener).not.toHaveBeenCalled();
  });

  it("エージェントのペインが入れ替わったら購読を張り直す", async () => {
    store.start();
    await flush();
    const before = server.countOf("events.subscribe");
    server.agents = [
      ...DEFAULT_AGENTS,
      { paneId: "wA:p1", workspaceId: "wA", status: "idle", title: "追加" },
    ];

    server.streamSocket()?.receiveMessage({ event: "pane_agent_detected", data: {} });
    await vi.advanceTimersByTimeAsync(1_000);
    await flush();

    expect(server.countOf("events.subscribe")).toBe(before + 1);
    expect(server.lastSubscriptions()).toContainEqual({
      type: "pane.agent_status_changed",
      pane_id: "wA:p1",
    });
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

    const before = server.countOf("events.subscribe");
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();

    expect(server.countOf("events.subscribe")).toBe(before + 1);
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
    const before = server.countOf("events.subscribe");

    store.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();

    expect(server.countOf("events.subscribe")).toBe(before);
    expect(store.state.status).toBe("offline");
  });
});
