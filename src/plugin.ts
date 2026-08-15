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
import { SendKeys } from "./actions/send-keys.js";
import { DEFAULT_SOCKET_PATH } from "./constants.js";
import { HerdrStore } from "./herdr/store.js";
import type { GlobalSettings } from "./settings.js";

const store = new HerdrStore({
  socketPath: DEFAULT_SOCKET_PATH,
  log: (message, error) =>
    error === undefined ? streamDeck.logger.info(message) : streamDeck.logger.warn(message, error),
});
const pager = new AgentPager(8);

streamDeck.actions.registerAction(new AgentSlot(store, pager));
streamDeck.actions.registerAction(new SendKeys(store));
streamDeck.actions.registerAction(new Prompt(store));
streamDeck.actions.registerAction(new PreviousAgentPage(store, pager));
streamDeck.actions.registerAction(new NextAgentPage(store, pager));
streamDeck.actions.registerAction(new SplitPane(store));
streamDeck.actions.registerAction(new SwapPane(store));
streamDeck.actions.registerAction(new ClosePane(store));

await streamDeck.connect();

// globalSettings は接続後でないと取れないため、既定パスで作ってから差し替える。
const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
store.setSocketPath(globalSettings.socketPath ?? DEFAULT_SOCKET_PATH);
store.start();
store.subscribe((state) => pager.clamp(state.status === "online" ? state.snapshot.agents.length : 0));

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
