# streamdeck-herdr

[herdr](https://herdr.dev) のエージェントを Stream Deck から操作するプラグイン。走っているエージェントの状態をキーの色で常時表示し、押せばそのエージェントへ切り替わる。承認・拒否・中断・定型プロンプトの投入もキー 1 つで行える。

操作モデルは OpenAI の Codex Micro に倣っている。対象は macOS + Stream Deck Neo（8 キー）。

## 必要なもの

- macOS 12 以降、Stream Deck ソフトウェア 6.4 以降
- herdr が同じマシンで動いていること（`~/.config/herdr/herdr.sock` を使う）

herdr が起動していないときは全キーがオフライン表示になり、起動し直せば自動で復帰する。

## アクション

| アクション | 役割 |
| --- | --- |
| エージェント | エージェント 1 つを 1 キーに割り当て、状態を色で表示する。押すとフォーカスする |
| キー送信 | 対象エージェントにキー列を送る（承認 / 拒否 / はい / いいえ / 自由入力） |
| プロンプト送信 | 対象エージェントに定型プロンプトを投入する |
| 中断 | 対象エージェントに Esc を送って実行を止める |

### 状態の色

| 状態 | 色 | 意味 |
| --- | --- | --- |
| idle | 白 | 入力待ち |
| working | 青 | 実行中 |
| blocked | 琥珀 | 承認・入力待ちで止まっている |
| done | 緑 | 終了済み・未確認 |
| unknown | 暗灰 | エージェントとして検出されていない |
| 空スロット | 破線枠 | 対応するエージェントがいない |
| オフライン | 赤い破線枠 | herdr に接続できていない |

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

herdr の API は「1 リクエスト 1 接続」で、応答を返すとサーバー側が接続を閉じる。長寿命の接続はイベント購読だけで、状態はイベントを合図に `session.snapshot` を取り直して更新している。
