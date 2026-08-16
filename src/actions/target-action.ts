/**
 * 対象エージェントに 1 回の操作を送るキーの共通部分。
 *
 * ターゲット解決・失敗時の表示・タイトル反映は 3 アクションで同じなので
 * ここにまとめ、実際に送るリクエストだけを派生クラスに書く。
 */

import streamDeck, {
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
} from "@elgato/streamdeck";

import type { HerdrStore } from "../herdr/store.js";
import { resolveTarget } from "../herdr/target.js";
import type { TargetSettings } from "../settings.js";

export abstract class TargetAction<T extends TargetSettings> extends SingletonAction<T> {
  protected readonly store: HerdrStore;

  constructor(store: HerdrStore) {
    super();
    this.store = store;
  }

  /** タイトル未設定のときにキーへ出す文字列。 */
  protected abstract defaultLabel(): string;

  /** 対象が決まったあとに実行する操作。失敗したら例外を投げる。 */
  protected abstract perform(target: string, settings: T): Promise<void>;

  /**
   * 設定からタイトルを決める。空文字を明示した場合はタイトルなしとして扱う。
   */
  protected label(settings: T & { label?: string }): string {
    return settings.label ?? this.defaultLabel();
  }

  /**
   * 設定に応じて差し替えるキー画像（プラグインフォルダ内のパス）。
   * `undefined` を返した場合は manifest の既定画像のまま。
   */
  protected image(_settings: T): string | undefined {
    return undefined;
  }

  override onWillAppear(ev: WillAppearEvent<T>): void {
    this.#apply(ev.action, ev.payload.settings);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<T>): void {
    this.#apply(ev.action, ev.payload.settings);
  }

  #apply(action: WillAppearEvent<T>["action"], settings: T): void {
    void action.setTitle(this.label(settings));
    const image = this.image(settings);
    if (image !== undefined && action.isKey()) {
      void action.setImage(image);
    }
  }

  override async onKeyDown(ev: KeyDownEvent<T>): Promise<void> {
    const settings = ev.payload.settings;
    const target = resolveTarget(settings, this.store.snapshot, "focused");
    if (target === null) {
      streamDeck.logger.warn("対象のエージェントが見つかりません");
      await ev.action.showAlert();
      return;
    }

    try {
      await this.perform(target, settings);
    } catch (error) {
      streamDeck.logger.error("herdr への操作に失敗しました", error);
      await ev.action.showAlert();
    }
  }
}
