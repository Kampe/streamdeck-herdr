/**
 * herdr ソケット API の型と、境界での検証。
 *
 * ソケットから届く JSON は信頼せず、ここで形を確認してから使う
 * （spec/herdr-control.md 6章「コーディング規約」）。
 * 未知のフィールドは無視し、必須フィールドの欠落・型不一致は弾く。
 * Zod 等のライブラリは追加せず、手書きの型ガードで実装する。
 */

/** herdr が検出するエージェントの状態。`done` は「終了したが未確認」を意味する。 */
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

const AGENT_STATUSES: readonly AgentStatus[] = ["idle", "working", "blocked", "done", "unknown"];

/** エージェントが動いているペイン 1 つ分の情報。 */
export type AgentInfo = {
  /** `agent.*` の `target` に渡す ID。ペインの開閉で振り直されるため保存してはならない。 */
  paneId: string;
  workspaceId: string;
  tabId: string;
  /** エージェント種別（`claude` / `codex` 等）。検出できていなければ null。 */
  agent: string | null;
  /** エージェントセッションの UUID。設定に保存する恒久 ID はこれを使う。 */
  sessionId: string | null;
  status: AgentStatus;
  /** 端末タイトル（スピナー等の装飾を除いたもの）。 */
  title: string;
  cwd: string;
  focused: boolean;
};

/** ワークスペース 1 つ分の情報。表示ラベルと並び順にだけ使う。 */
export type WorkspaceInfo = {
  workspaceId: string;
  label: string;
  /** herdr のサイドバーに出る 1 始まりの番号。 */
  number: number;
};

/** `session.snapshot` から取り出した、プラグインが必要とする範囲の状態。 */
export type SessionSnapshot = {
  agents: AgentInfo[];
  workspaces: WorkspaceInfo[];
  focusedPaneId: string | null;
};

/** `pane.agent_status_changed` イベントの中身。 */
export type AgentStatusChange = {
  paneId: string;
  status: AgentStatus;
  /** エージェント種別。イベントに含まれないこともある。 */
  agent: string | null;
};

/** ソケットから届く 1 行を分類したもの。 */
export type HerdrMessage =
  | { kind: "result"; id: string; result: unknown }
  | { kind: "error"; id: string; code: string; message: string }
  | { kind: "event"; event: string; data: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** 未知の状態値が増えても壊れないよう、知らない値は `unknown` に落とす。 */
function parseAgentStatus(value: unknown): AgentStatus {
  return AGENT_STATUSES.find((status) => status === value) ?? "unknown";
}

/**
 * `agent_session` から恒久 ID を取り出す。`kind` が `id` のときだけ UUID として扱い、
 * `path` （セッションファイルのパスで識別している状態）は保存対象にしない。
 */
function parseSessionId(value: unknown): string | null {
  if (!isRecord(value) || value.kind !== "id" || !isString(value.value)) {
    return null;
  }
  return value.value;
}

/**
 * エージェント 1 件を検証する。ペインを一意に指せない（`pane_id` が無い）ものは使えないため null。
 */
function parseAgent(value: unknown): AgentInfo | null {
  if (!isRecord(value)) {
    return null;
  }
  const { pane_id, workspace_id, tab_id } = value;
  if (!isString(pane_id) || !isString(workspace_id) || !isString(tab_id)) {
    return null;
  }
  return {
    paneId: pane_id,
    workspaceId: workspace_id,
    tabId: tab_id,
    agent: isString(value.agent) ? value.agent : null,
    sessionId: parseSessionId(value.agent_session),
    status: parseAgentStatus(value.agent_status),
    title: isString(value.terminal_title_stripped) ? value.terminal_title_stripped : "",
    cwd: isString(value.cwd) ? value.cwd : "",
    focused: value.focused === true,
  };
}

/**
 * ワークスペース 1 件を検証する。`number` が無い場合は並び順を決められないので
 * 末尾に送るために `Number.MAX_SAFE_INTEGER` を入れる。
 */
function parseWorkspace(value: unknown): WorkspaceInfo | null {
  if (!isRecord(value) || !isString(value.workspace_id)) {
    return null;
  }
  return {
    workspaceId: value.workspace_id,
    label: isString(value.label) ? value.label : value.workspace_id,
    number: typeof value.number === "number" ? value.number : Number.MAX_SAFE_INTEGER,
  };
}

/**
 * `session.snapshot` の `result` を検証する。
 *
 * - `snapshot.agents` が配列でなければ全体を null（状態を組み立てられないため）
 * - 個々のエージェント / ワークスペースは壊れていてもその要素だけスキップする
 *   （1 ペイン壊れていても他のキーを使えるようにするため）
 */
export function parseSessionSnapshot(value: unknown): SessionSnapshot | null {
  if (!isRecord(value) || !isRecord(value.snapshot)) {
    return null;
  }
  const snapshot = value.snapshot;
  if (!Array.isArray(snapshot.agents)) {
    return null;
  }

  const agents: AgentInfo[] = [];
  for (const item of snapshot.agents) {
    const agent = parseAgent(item);
    if (agent !== null) {
      agents.push(agent);
    }
  }

  const workspaces: WorkspaceInfo[] = [];
  if (Array.isArray(snapshot.workspaces)) {
    for (const item of snapshot.workspaces) {
      const workspace = parseWorkspace(item);
      if (workspace !== null) {
        workspaces.push(workspace);
      }
    }
  }

  return {
    agents,
    workspaces,
    focusedPaneId: isString(snapshot.focused_pane_id) ? snapshot.focused_pane_id : null,
  };
}

/**
 * `pane.agent_status_changed` の `data` を検証する。
 * ペインを特定できなければ null（どのキーに反映すべきか決められないため）。
 */
export function parseAgentStatusChange(value: unknown): AgentStatusChange | null {
  if (!isRecord(value) || !isString(value.pane_id)) {
    return null;
  }
  return {
    paneId: value.pane_id,
    status: parseAgentStatus(value.agent_status),
    agent: isString(value.agent) ? value.agent : null,
  };
}

/**
 * ソケットから届いた 1 行を分類する。
 *
 * - `{"id","result"}` は応答、`{"id","error"}` は失敗した応答
 * - `{"event","data"}` は購読中に流れてくるイベント（`id` を持たない）
 * - どれにも当てはまらない行は null（無視して読み進める）
 */
export function parseHerdrMessage(value: unknown): HerdrMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  if (isString(value.event)) {
    return { kind: "event", event: value.event, data: value.data };
  }

  if (!isString(value.id)) {
    return null;
  }

  if (isRecord(value.error)) {
    const { code, message } = value.error;
    return {
      kind: "error",
      id: value.id,
      code: isString(code) ? code : "unknown",
      message: isString(message) ? message : "詳細不明のエラー",
    };
  }

  if ("result" in value) {
    return { kind: "result", id: value.id, result: value.result };
  }

  return null;
}
