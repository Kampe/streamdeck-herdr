---
type: Spec
status: APPROVED
---

# herdr 操作 Stream Deck プラグイン

## 1. 目的とスコープ

複数の AI コーディングエージェント（Claude Code / Codex 等）を herdr のペインで並列に走らせているとき、どのエージェントが何を待っているかは herdr の TUI を見に行かないと分からない。これを Stream Deck の物理キーに常時表示し、切り替え・承認・中断・プロンプト投入をキー 1 つで行えるようにする。

操作モデルは OpenAI の Codex Micro（エージェントスロットキーの色で状態を示し、押せばそのタスクへ切り替わり、承認 / 拒否をハードキーで叩く）に倣う。

**対象ユーザー**: macOS で herdr と Stream Deck Neo を使う本人（個人利用）。

### スコープ内

| アクション | 説明 |
| --- | --- |
| エージェント (`agent-slot`) | herdr のエージェント 1 つを 1 キーに割り当て、状態を色で表示する。押すとそのエージェントをフォーカスする |
| キー送信 (`send-keys`) | 対象エージェントに任意のキー列を送る。承認 / 拒否のプリセットを持つ |
| プロンプト送信 (`prompt`) | 対象エージェントに定型プロンプトを投入する |
| 中断 (`interrupt`) | 対象エージェントに Esc を送って実行を止める |

### スコープ外（今回は作らない）

- ワークスペース / タブの作成・切替、ペイン分割、エージェントの新規起動
- ペイン出力の読み出し・Stream Deck 上での表示
- Stream Deck + の Encoder（ダイヤル）対応。Neo には Encoder がない
- Windows 対応。herdr のソケットパス解決が異なるため mac のみを対象とする
- リモート herdr（`--remote`）への接続

## 2. 前提となる外部仕様

### herdr ソケット API

- トランスポート: Unix ドメインソケット。JSONL（1 リクエスト 1 行）
- パス解決: `HERDR_SOCKET_PATH` → `HERDR_SESSION`（`~/.config/herdr/sessions/<name>/herdr.sock`）→ 既定 `~/.config/herdr/herdr.sock`
- リクエスト: `{"id": "...", "method": "...", "params": {...}}`
- 成功: `{"id": "...", "result": {...}}` / 失敗: `{"id": "...", "error": {"code": "...", "message": "..."}}`
- プロトコル番号は `session.snapshot` の `protocol` に入る（開発時点で 17）

使用するメソッド:

| メソッド | 用途 |
| --- | --- |
| `session.snapshot` | ワークスペース / タブ / ペイン / エージェントの全状態を一括取得 |
| `events.subscribe` | 状態変化の購読。以後、同じ接続にイベントが流れ続ける |
| `agent.focus` | エージェントをフォーカスする |
| `agent.send_keys` | エージェントにキー列を送る |
| `agent.prompt` | エージェントにプロンプトを投入する |

### エージェントの識別

- `agent.*` の `target` は **pane_id**（例 `wE:p1`）を受ける。エージェント名や連番は受け付けない
- pane_id はペインの開閉で振り直されるため、**恒久的な識別子として使ってはならない**
- 恒久キーには `agent_session.value`（エージェントセッションの UUID）を使い、スナップショットから現在の pane_id に解決する

### エージェント状態

`agent_status` は `idle` / `working` / `blocked` / `done` / `unknown` の 5 値。`done` は「終了したがまだそのペインを見ていない」を意味する。

### イベント購読の制約

- `pane.agent_status_changed` は購読時に `pane_id` を要求する（ペイン個別購読）。スロットの割り当てが変わるたびに購読を張り替える必要があり、扱いにくい
- 一方 `pane.created` / `pane.updated` / `pane.closed` および `workspace.*` / `tab.*` はセッション全体で購読でき、`pane_updated` の `PaneInfo` に `agent_status` が含まれる
- したがって本プラグインは**セッション全体のイベントのみを購読**し、状態の実体は毎回 `session.snapshot` で取り直す

## 3. 成功基準（受け入れ条件）

1. herdr が起動していれば、`agent-slot` キーが現在のエージェントの状態色（idle / working / blocked / done）で点灯し、ワークスペース名がタイトルに出る
2. 別のペインでエージェントが動き出してから **1 秒以内**に該当キーの色が `working` に変わる
3. `agent-slot` キーを押すと herdr のフォーカスがそのエージェントへ移る（`session.snapshot` の `focused_pane_id` が一致する）
4. `prompt` キーを押すと対象エージェントに設定したテキストが投入される
5. `interrupt` キーを押すと実行中のエージェントが止まる
6. herdr が起動していない / 途中で停止した場合、全キーがオフライン表示になり、押しても API を叩かず `showAlert()` を出す。herdr を起動し直すと **10 秒以内**に自動で復帰する
7. スロットに対応するエージェントが存在しない場合、空スロット表示になり、押しても何も起きない
8. `npm run build` と `streamdeck validate` が成功する

## 4. 技術スタックとプロジェクト構成

- 言語: TypeScript（strict）
- SDK: `@elgato/streamdeck`（公式 Node.js SDK）、`@elgato/cli`
- ビルド: Rollup（`@elgato/cli` の標準構成）
- テスト: `vitest`。ソケットはフェイクに差し替えて検証する
- プラグイン UUID: `com.github.yuntan.herdr`
- 追加の実行時依存は入れない（Node 標準の `net` のみでソケットを扱う）

```
streamdeck-herdr/
├── spec/
│   └── herdr-control.md               # 本書
├── tasks/
│   └── plan.md                        # 実装計画
├── src/
│   ├── plugin.ts                      # エントリポイント。ストア起動とアクション登録
│   ├── constants.ts                   # UUID / ソケットパス / 間隔 / 状態色
│   ├── settings.ts                    # action settings の型
│   ├── herdr/
│   │   ├── types.ts                   # API の型と境界バリデーション
│   │   ├── socket.ts                  # JSONL ソケット接続（低レベル）
│   │   ├── client.ts                  # request / subscribe の型付きラッパー
│   │   ├── store.ts                   # スナップショット保持と配信
│   │   ├── target.ts                  # スロット指定 → pane_id 解決（純関数）
│   │   └── keys.ts                    # キープリセット → キー列（純関数）
│   ├── render/
│   │   └── key-image.ts               # 状態色つきキー画像の生成（純関数）
│   └── actions/
│       ├── agent-slot.ts
│       ├── send-keys.ts
│       ├── prompt.ts
│       └── interrupt.ts
├── com.github.yuntan.herdr.sdPlugin/
│   ├── manifest.json
│   ├── bin/plugin.js                  # ビルド成果物
│   ├── imgs/                          # アイコン
│   ├── profiles/                      # Stream Deck Neo 用の既定プロファイル
│   └── ui/                            # Property Inspector
├── package.json
├── rollup.config.mjs
└── tsconfig.json
```

## 5. 設計

### 5.1 接続とデータフロー

プラグインプロセス内にシングルトンの `HerdrStore` を置き、全アクションがそれを共有する。

1. 起動時にソケットへ接続し、`session.snapshot` で初期状態を取得する
2. 同じ接続で `events.subscribe` を張る。購読対象は `workspace.created/updated/closed/focused`、`tab.created/closed/focused`、`pane.created/updated/closed`
3. イベントを受け取ったら **150 ms のデバウンス**を挟んで `session.snapshot` を取り直す。イベントの差分を自前で適用するより単純で、状態が実体とずれない。イベント頻度は人間の操作速度なので負荷にならない
4. スナップショットが更新されたら購読中のアクションへ通知する
5. 接続が切れたら状態を「オフライン」にして全アクションへ通知し、**2 秒間隔**で再接続する

購読は `onWillAppear` で登録し `onWillDisappear` で解除する。表示されていないキーは再描画しない。

ソケットパスは Stream Deck のプラグインプロセスが herdr の環境変数を継承しないため、既定パスを使う。`globalSettings.socketPath` で上書きできる。

### 5.2 ターゲットの指定

`send-keys` / `prompt` / `interrupt` は対象エージェントを 3 通りで指定できる。

| モード | 意味 |
| --- | --- |
| `focused` | herdr で現在フォーカスされているエージェント |
| `index` | エージェント一覧の N 番目（Codex Micro の動的スロット相当） |
| `session` | 特定のエージェントセッション UUID に固定 |

`agent-slot` は `index` と `session` のみを持つ（`focused` では意味を成さない）。

`index` の並び順は **ワークスペース番号の昇順、同一ワークスペース内は pane_id の昇順**で安定させる。ペインの開閉で並びが変わるのは仕様（Codex Micro のスロットと同じ挙動）とし、固定したい場合は `session` を使う。

解決は `resolveTarget(settings, snapshot): string | null` という純関数で行い、単体テストする。

### 5.3 キープリセット

`send-keys` はプリセットまたは自由入力でキー列を決める。

| プリセット | 送るキー | 用途 |
| --- | --- | --- |
| `approve` | `Enter` | 承認プロンプトの既定選択を確定する |
| `reject` | `esc` | 承認プロンプトを取り消す |
| `yes` | `y`, `Enter` | y/n 形式の確認 |
| `no` | `n`, `Enter` | 同上 |
| `custom` | 自由入力（空白区切り） | エージェント固有の選択肢（`2` + `Enter` 等） |

Escape の正規名は `esc` とする（herdr は `escape` も受け付けるが 1 つに揃える）。プリセット → キー列の変換は純関数として切り出す。

### 5.4 表示

`agent-slot` は `setImage()` で動的に生成した SVG を出す。

- 背景を状態色で塗り、中央にエージェント種別（`claude` / `codex` 等）の頭文字を大きく描く
- 右上にスロット番号（`index` モードのとき）を小さく添える
- キーのタイトルにはワークスペース名を出す（`labelSource` で端末タイトル / 任意文字列にも変更できる）

状態色:

| 状態 | 色 | 意味 |
| --- | --- | --- |
| `idle` | 白 | 入力待ち |
| `working` | 青 | 実行中 |
| `blocked` | 琥珀 | 承認・入力待ちで止まっている |
| `done` | 緑 | 終了済み・未確認 |
| `unknown` | 暗灰 | エージェントとして検出されていない |
| 空スロット | ほぼ黒 + 破線枠 | 対応するエージェントがいない |
| オフライン | ほぼ黒 + 斜線 | herdr に接続できていない |

`send-keys` / `prompt` / `interrupt` は静的アイコンを使い、タイトルにユーザー設定のラベルを出す。押下に失敗したら `showAlert()`、成功したら `showOk()` を出す。

### 5.5 設定の保存先

- `globalSettings`: `{ socketPath?: string }` — 全アクションで共有する
- action settings: アクションごと（`binding` / `index` / `sessionId` / `labelSource` / `customLabel` / `preset` / `keys` / `text`）

Property Inspector のエージェント選択ドロップダウンは、プラグイン側が保持しているスナップショットから `sendToPlugin` 経由で供給する（PI から直接ソケットを開かない）。

## 6. コーディング規約

- **不変性**: 状態オブジェクトは書き換えず、新しいオブジェクトへ差し替える
- 1 ファイル 200〜400 行を目安、上限 800 行
- 関数は 50 行未満、ネストは 4 段まで
- ハードコードした値（再接続間隔、デバウンス時間、状態色、既定ソケットパス）は `constants.ts` に集約する
- ソケットから来た JSON は信頼せず、境界で形を検証してから使う。Zod 等のライブラリは追加せず、手書きの型ガードで実装する
- エラーを握り潰さない。ユーザーに見せるメッセージは日本語、詳細は `streamDeck.logger` に出す

## 7. テスト戦略

| 対象 | 方法 |
| --- | --- |
| 型ガード | 壊れた JSON、欠けたフィールド、想定外の `agent_status` を投入して落ちないこと |
| ソケットクライアント | フェイクソケットに差し替え、分割到着した JSONL の結合、id の対応付け、`error` の例外化、切断時の再接続を検証 |
| ストア | フェイクタイマー。デバウンスされた再取得、購読者への通知、オフライン遷移と復帰 |
| ターゲット解決 | index の並び順、範囲外、セッション UUID の解決失敗、`focused` でエージェント以外がフォーカス中の場合 |
| キープリセット | 各プリセットの出力、自由入力のパース（空白・空文字・過剰な空白） |
| キー画像 | 状態ごとの色、ラベルの XML エスケープ、長いラベルの切り詰め |
| 実機確認 | 実際の Stream Deck Neo に配置し、成功基準 1〜7 を手動で確認 |

## 8. 境界

### Always（常にやる）

- 接続先はローカルの herdr ソケットのみ。パスは既定値か `globalSettings` の明示指定に限る
- ソケットから来た値は境界で検証してから使う
- pane_id は毎回スナップショットから解決し直す（キャッシュして使い回さない）
- 切断・エラー時はキー表示にそれが分かる形で反映し、無言で失敗しない
- 接続が切れている間は API を叩かず、再接続を待つ

### Ask First（先に確認する）

- 再接続間隔・デバウンス時間を本仕様の値から変える場合
- スコープ外の機能（ワークスペース操作、ペイン分割、出力表示）を追加する場合
- 依存パッケージを追加する場合
- リポジトリを GitHub に公開する、または Marketplace へ配布する場合

### Never（やらない）

- herdr の設定ファイル（`config.toml`）を書き換える
- `server.stop` など herdr 自体を停止させる操作をキーに割り当てる
- エージェントのペイン出力を外部へ送信する、またはログに残す
- ユーザー操作なしにプロンプトやキーをエージェントへ送る
