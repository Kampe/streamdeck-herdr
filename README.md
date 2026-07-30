# streamdeck-herdr

[herdr](https://herdr.dev) のエージェントを Stream Deck から操作するプラグイン。走っているエージェントの状態をキーの色で常時表示し、押せばそのエージェントへ切り替わる。承認・拒否・中断・定型プロンプトの投入もキー 1 つで行える。

操作モデルは OpenAI の Codex Micro に倣っている。対象は macOS + Stream Deck Neo（8 キー）。

![Stream Deck Neo で herdr のエージェントを操作している様子](docs/streamdeck-neo.jpg)

上段の 4 キーがエージェントで、キーの中央に種別のグリフ（左 2 つが `claude`、3 つ目が `codex`、4 つ目が `opencode`）、下にワークスペース名が出る。

## 必要なもの

- macOS 12 以降、Stream Deck ソフトウェア 6.4 以降
- herdr が同じマシンで動いていること（`~/.config/herdr/herdr.sock` を使う）

herdr が起動していないときは全キーがオフライン表示になり、起動し直せば自動で復帰する。

## アクション

| アクション | 役割 |
| --- | --- |
| エージェント | エージェント 1 つを 1 キーに割り当て、状態を色で表示する。押すとフォーカスする |
| キー送信 | 対象エージェントにキー列を送る（承認 / 拒否 / はい / いいえ / 中断 / 自由入力） |
| プロンプト送信 | 対象エージェントに定型プロンプトを投入する |

### 状態の色

| 状態 | 色 | 意味 |
| --- | --- | --- |
| idle | 黒 | 入力待ち |
| working | オレンジ | 実行中 |
| blocked | 赤 | 承認・入力待ちで止まっている |
| done | 水色 | 終了済み・未確認 |
| unknown | 暗灰 | エージェントとして検出されていない |
| 空スロット | 破線枠 + `—` | 対応するエージェントがいない |
| オフライン | 赤い破線枠 + `×` | herdr に接続できていない |

キーの中央にはエージェント種別のグリフが出る。`claude` / `codex` / `gemini` / `cursor` / `opencode` は各社の公式ロゴマークを状態色で塗ったもの（パスの出所は [simple-icons](https://github.com/simple-icons/simple-icons)（CC0-1.0）と [lobe-icons](https://github.com/lobehub/lobe-icons)（MIT）、商標は各社に帰属）。それ以外の種別は頭 2 文字の字面（`cline` なら `CL`）。

「キー送信」はプリセットに応じてアイコンが変わる（承認 = チェック、拒否 = バツ、はい = `Y`、いいえ = `N`、中断 = 停止マーク、自由入力 = キーキャップ）。

拒否と中断はどちらも Esc を送る。送るキーは同じでも、承認プロンプトを取り消すのか処理を止めるのかで押す動機が違うので、ラベルとアイコンを分けて両方用意している。

### 対象の指定

- **フォーカス中のエージェント** — herdr で今フォーカスしているエージェント
- **順番で指定** — ワークスペース番号順に数えて N 番目（Codex Micro の動的スロット相当）
- **エージェントを固定** — 特定のエージェントセッションに固定する

「エージェント」アクションは順番か固定のどちらかを選ぶ。

## インストール（開発）

```sh
npm install
npm run build
npx streamdeck link com.github.yuntan.herdr.sdPlugin
npx streamdeck restart com.github.yuntan.herdr
```

変更しながら動かす場合は `npm run watch` と `npx streamdeck dev` を使う。ログは `com.github.yuntan.herdr.sdPlugin/logs/` に出る。

## Neo 用プロファイル

`com.github.yuntan.herdr.sdPlugin/profiles/herdr-neo.streamDeckProfile` に 8 キー分の配置を同梱している（上段 = エージェント 1〜4、下段 = 承認 / 拒否 / 中断 / プロンプト）。Stream Deck アプリのプロファイル一覧から読み込むか、ファイルをダブルクリックして取り込む。

配置を変えたいときは `scripts/build-profile.mjs` の `KEYS` を編集して `npm run build:profile` で作り直す。

## 設定

ソケットパスは既定で `~/.config/herdr/herdr.sock`。名前付きセッション（`herdr --session <name>`）を使っている場合は、どれかのアクションの Property Inspector にある「ソケットパス」に `~/.config/herdr/sessions/<name>/herdr.sock` を入れる（全アクション共通の設定として保存される）。

## 開発

```sh
npm test          # vitest
npm run build     # rollup
npm run validate  # streamdeck validate
```

仕様は [spec/herdr-control.md](spec/herdr-control.md)、実装計画は [tasks/plan.md](tasks/plan.md)。

herdr の API は「1 リクエスト 1 接続」で、応答を返すとサーバー側が接続を閉じる。長寿命の接続はイベント購読だけ。

エージェントの状態はペインごとの `pane.agent_status_changed` を購読してその場で反映する（10〜100 ms で色が変わる）。ペインやワークスペースの増減は低頻度のイベントを合図に `session.snapshot` を取り直す。`pane.updated` はエージェントの出力中に毎秒 30 件近く流れるため購読していない。
