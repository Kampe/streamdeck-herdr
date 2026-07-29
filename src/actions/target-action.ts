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

  override onWillAppear(ev: WillAppearEvent<T>): void {
    void ev.action.setTitle(this.label(ev.payload.settings));
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<T>): void {
    void ev.action.setTitle(this.label(ev.payload.settings));
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
      await ev.action.showOk();
    } catch (error) {
      streamDeck.logger.error("herdr への操作に失敗しました", error);
      await ev.action.showAlert();
    }
  }
}
