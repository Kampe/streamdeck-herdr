/**
 * globalSettings と各アクションの設定型。
 *
 * `@elgato/streamdeck` は設定値が `JsonObject` を構造的に満たすことを要求するため、
 * `interface` ではなく `type` エイリアスで宣言する。
 * 未設定のキーは省略されうるので、すべて optional として扱い、既定値は利用側で補う。
 */

/** 対象エージェントの指定方法。 */
export type TargetBinding = "focused" | "index" | "session";

/** `send-keys` に用意したキープリセット。 */
export type KeyPreset = "approve" | "reject" | "yes" | "no" | "interrupt" | "custom";

/** `agent-slot` のラベルに何を出すか。 */
export type LabelSource = "workspace" | "title" | "custom";

/** 全アクションで共有する設定。 */
export type GlobalSettings = {
  /** 既定以外の herdr ソケットを使う場合のパス。 */
  socketPath?: string;
};

/** 対象エージェントを指定するアクションが共通で持つ設定。 */
export type TargetSettings = {
  binding?: TargetBinding;
  /** `binding` が `index` のときの 1 始まりの順番。 */
  index?: number;
  /** `binding` が `session` のときのエージェントセッション UUID。 */
  sessionId?: string;
};

export type AgentSlotSettings = TargetSettings & {
  /** Treat `index` as a slot on the shared agent page instead of an absolute index. */
  paged?: boolean;
  labelSource?: LabelSource;
  customLabel?: string;
};

export type SendKeysSettings = TargetSettings & {
  preset?: KeyPreset;
  /** `preset` が `custom` のときに送るキー列（空白区切り）。 */
  keys?: string;
  label?: string;
};

export type PromptSettings = TargetSettings & {
  text?: string;
  label?: string;
};

export type QuotaSettings = {
  provider?: "claude" | "codex" | "antigravity" | "grok";
  pool?: "all" | "default" | "fable" | "spark" | "gemini" | "nonGemini";
};

export type InterruptSettings = TargetSettings & {
  label?: string;
};
