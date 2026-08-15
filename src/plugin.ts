/**
 * プラグインのエントリポイント。
 *
 * herdr への接続はプラグインプロセスに 1 つだけ持ち、全アクションで共有する。
 */

import streamDeck from "@elgato/streamdeck";

import { AgentPager } from "./agent-pager.js";
import {
  AGENT_DATA_SOURCE,
  agentDataSourceItems,
  isAgentDataSourceRequest,
} from "./actions/agent-datasource.js";
import { AgentSlot } from "./actions/agent-slot.js";
import { Prompt } from "./actions/prompt.js";
import { NextAgentPage, PreviousAgentPage } from "./actions/page-navigation.js";
import { ClosePane, SplitPane, SwapPane } from "./actions/pane-control.js";
import { Quota } from "./actions/quota.js";
import { SendKeys } from "./actions/send-keys.js";
import { DEFAULT_SOCKET_PATH } from "./constants.js";
import { HerdrStore } from "./herdr/store.js";
import { sortAgents } from "./herdr/target.js";
import type { GlobalSettings } from "./settings.js";
import { QuotaStore } from "./quota/store.js";

const store = new HerdrStore({
  socketPath: DEFAULT_SOCKET_PATH,
  log: (message, error) =>
    error === undefined ? streamDeck.logger.info(message) : streamDeck.logger.warn(message, error),
});
const pager = new AgentPager(8);
const quotaStore = new QuotaStore();

streamDeck.actions.registerAction(new AgentSlot(store, pager));
streamDeck.actions.registerAction(new SendKeys(store));
streamDeck.actions.registerAction(new Prompt(store));
streamDeck.actions.registerAction(new PreviousAgentPage(store, pager));
streamDeck.actions.registerAction(new NextAgentPage(store, pager));
streamDeck.actions.registerAction(new SplitPane(store));
streamDeck.actions.registerAction(new SwapPane(store));
streamDeck.actions.registerAction(new ClosePane(store));
streamDeck.actions.registerAction(new Quota(quotaStore));

await streamDeck.connect();

// globalSettings は接続後でないと取れないため、既定パスで作ってから差し替える。
const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
store.setSocketPath(globalSettings.socketPath ?? DEFAULT_SOCKET_PATH);
store.start();
quotaStore.start();
let previousFocusedPaneId: string | null | undefined;
store.subscribe((state) => {
  if (state.status !== "online") {
    pager.clamp(0);
    previousFocusedPaneId = undefined;
    return;
  }

  const { snapshot } = state;
  pager.clamp(snapshot.agents.length);
  if (
    snapshot.focusedPaneId !== null &&
    snapshot.focusedPaneId !== previousFocusedPaneId
  ) {
    const index = sortAgents(snapshot).findIndex(
      (agent) => agent.paneId === snapshot.focusedPaneId,
    );
    pager.showAbsoluteIndex(index + 1, snapshot.agents.length);
  }
  previousFocusedPaneId = snapshot.focusedPaneId;
});

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
  store.setSocketPath(ev.settings.socketPath ?? DEFAULT_SOCKET_PATH);
});

// Property Inspector のエージェント一覧は、プラグインが持っている状態から返す。
streamDeck.ui.onSendToPlugin((ev) => {
  if (!isAgentDataSourceRequest(ev.payload)) {
    return;
  }
  void streamDeck.ui.sendToPropertyInspector({
    event: AGENT_DATA_SOURCE,
    items: agentDataSourceItems(store.snapshot),
  });
});
