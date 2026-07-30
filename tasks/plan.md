# 実装計画: herdr 操作 Stream Deck プラグイン

対象仕様: `spec/herdr-control.md` (APPROVED)

各タスクは RED → GREEN → 回帰 → ビルド → コミット の順で進め、1 タスク 1 コミットとする。

---

## T1. プロジェクト雛形とビルド基盤

依存: なし

`package.json` / `tsconfig.json` / `rollup.config.mjs` / `vitest.config.ts` / `.gitignore` と、`com.github.yuntan.herdr.sdPlugin/manifest.json`（4 アクション分）、アイコン素材、Property Inspector のプレースホルダを用意する。`src/plugin.ts` は `streamDeck.connect()` のみ。

**受け入れ条件**
- `npm run build` が成功し `com.github.yuntan.herdr.sdPlugin/bin/plugin.js` が生成される
- `npx streamdeck validate com.github.yuntan.herdr.sdPlugin` が成功する
- `.gitignore` に `node_modules/`、`*.sdPlugin/bin/`、`*.log` が含まれる
- `manifest.json` の `UUID` が `com.github.yuntan.herdr`、`OS` は mac のみ

---

## T2. 仕様書と実装計画

依存: T1

`spec/herdr-control.md` と `tasks/plan.md`（本書）を書く。

**受け入れ条件**
- 仕様に成功基準・状態色表・Always / Ask First / Never が含まれる
- ソケット API の使用メソッドと、pane_id を恒久 ID として使わない理由が明記されている

---

## T3. API 型定義と境界バリデーション

依存: T1

- `src/herdr/types.ts` — `AgentStatus` / `AgentInfo` / `WorkspaceInfo` / `SessionSnapshot` / レスポンス封筒の型と、`parseSessionSnapshot()` などの手書き型ガード
- `src/constants.ts` — 既定ソケットパス、再接続間隔 2000ms、スナップショット再取得デバウンス 150ms、状態色、アクション UUID
- `src/settings.ts` — `GlobalSettings` と各アクションの settings 型

**受け入れ条件（先にテストを書く）**
- 必須フィールドが欠けたエージェントはスキップされ、他のエージェントは残る
- 未知の `agent_status` は `unknown` に落とす
- `agents` が配列でないスナップショットは `null` を返す
- マジックナンバーがすべて `constants.ts` に集約されている

---

## T4. ソケットクライアント

依存: T3

- `src/herdr/socket.ts` — `net.createConnection` を DI で受け取り、JSONL の送受信・行の再結合・切断検知を行う低レベル層
- `src/herdr/client.ts` — `request(method, params)` と `subscribe(types, onEvent)`、`HerdrApiError` / `HerdrConnectionError`

**受け入れ条件（フェイクソケットで検証）**
- 1 つの chunk に複数行が来ても、1 行が複数 chunk に分割されても正しく復元する
- `id` でリクエストとレスポンスが対応づく（並行リクエストが混線しない）
- `error` レスポンスは `HerdrApiError`（`code` を保持）として reject される
- 切断時、未解決のリクエストが `HerdrConnectionError` で reject される
- ソケットのパスやエラーメッセージにユーザーの秘密情報を含めない

---

## T5. スナップショットストア

依存: T4

`src/herdr/store.ts` に `HerdrStore`。接続・初期スナップショット取得・イベント購読・デバウンス再取得・購読者への通知・オフライン遷移・再接続。

**受け入れ条件（フェイクタイマー）**
- 起動時に `session.snapshot` を 1 回だけ呼び、その後 `events.subscribe` を張る
- イベントが 100ms 間隔で 5 回来ても `session.snapshot` の再取得は 1 回にまとまる
- 切断すると購読者に `offline` が通知され、2 秒後に再接続を試みる
- 購読者が 0 でも接続は維持する（初回表示を速くするため）
- 購読解除した後に通知が飛ばない

---

## T6. ターゲット解決（純関数）

依存: T3

`src/herdr/target.ts` に `sortAgents(snapshot)` と `resolveTarget(settings, snapshot)`。

**受け入れ条件（先にテストを書く）**
- `focused` はフォーカス中のペインがエージェントならその pane_id、そうでなければ `null`
- `index` はワークスペース番号昇順・pane_id 昇順で N 番目を返し、範囲外は `null`
- `session` は `agent_session.value` が一致するエージェントの現在の pane_id を返し、見つからなければ `null`
- スナップショットが `null`（オフライン）なら常に `null`

---

## T7. キープリセット（純関数）

依存: T3

`src/herdr/keys.ts` に `resolveKeys(preset, custom)`。

**受け入れ条件（先にテストを書く）**
- `approve` / `reject` / `yes` / `no` が仕様どおりのキー列を返す
- `custom` は空白区切りをトリムして配列にし、連続空白や前後空白を無視する
- `custom` が空文字なら空配列を返す（呼び出し側が送信を抑止できる）
- `escape` 表記は `esc` に正規化する

---

## T8. キー画像の生成（純関数）

依存: T3

`src/render/key-image.ts` に `renderAgentKey(state)`。状態・ラベル・エージェント種別・スロット番号から `data:image/svg+xml;base64,...` を返す。

**受け入れ条件（先にテストを書く）**
- 状態ごとに `constants.ts` の色が使われる
- 空スロットとオフラインは専用の見た目になる
- ラベルの `&` `<` `>` `"` が XML エスケープされる
- 長すぎるラベルは省略記号付きで切り詰められる
- 返り値が `data:image/svg+xml;base64,` で始まる

---

## T9. エージェントスロットアクション

依存: T5, T6, T8

`src/actions/agent-slot.ts` を実装し `src/plugin.ts` に登録する。`onWillAppear` でストアを購読、`onWillDisappear` で解除、`onKeyDown` で `agent.focus`。

**受け入れ条件**
- 実機で状態色が 1 秒以内に追随する
- 押下でフォーカスが移り、`session.snapshot` の `focused_pane_id` が一致する
- 空スロット・オフラインでは API を呼ばず `showAlert()` を出す

---

## T10. キー送信・プロンプト・中断アクション（中断は後にキー送信のプリセットへ統合）

依存: T5, T6, T7

`src/actions/send-keys.ts` / `prompt.ts` / `interrupt.ts` を実装し登録する（`interrupt.ts` はのちに `send-keys` の `interrupt` プリセットへ統合し削除）。ターゲット解決とラベル表示は共通ヘルパにまとめる。

**受け入れ条件**
- 各アクションが対象エージェントに正しいリクエストを送る
- ターゲットが解決できない場合は `showAlert()` を出し、リクエストを送らない
- 成功時は `showOk()` を出す

---

## T11. Property Inspector

依存: T9, T10

`ui/*.html` を `sdpi-components` で実装する。エージェント選択ドロップダウンはプラグイン側のスナップショットから `sendToPlugin` で供給する。

**受け入れ条件**
- `agent-slot` で「N 番目」と「特定のエージェントに固定」を切り替えられる
- 固定モードでは現在のエージェント一覧がドロップダウンに出る
- `send-keys` でプリセットを選ぶと自由入力欄の要否が切り替わる
- ソケットパスの上書き欄が `globalSettings` に保存される
- PI からソケットを直接開いていない

---

## T12. Neo 用プロファイルと README

依存: T11

Stream Deck Neo（8 キー）向けの既定プロファイルを同梱する。上段 = エージェント 1〜4、下段 = 承認 / 拒否 / 中断 / プロンプト。README にインストール手順と各アクションの説明を書く。

**受け入れ条件**
- プロファイルが Stream Deck アプリで読み込め、8 キーが仕様どおりに並ぶ
- README に `streamdeck link` を使った開発手順と、herdr が必要である旨が書かれている
