/**
 * プラグインのエントリポイント。
 *
 * herdr への接続はプラグインプロセスに 1 つだけ持ち、全アクションで共有する。
 */

import streamDeck from "@elgato/streamdeck";
import { homedir } from "node:os";
import { join } from "node:path";

import { AgentPager } from "./agent-pager.js";
import {
  AGENT_DATA_SOURCE,
  agentDataSourceItems,
  isAgentDataSourceRequest,
} from "./actions/agent-datasource.js";
import { AgentSlot } from "./actions/agent-slot.js";
import { AgentQueue } from "./actions/agent-queue.js";
import { AgentView } from "./actions/agent-view.js";
import { WorkspacePage } from "./actions/workspace-page.js";
import { Favorite } from "./actions/favorite.js";
import { Health } from "./actions/health.js";
import { Recovery } from "./actions/recovery.js";
import { Session } from "./actions/session.js";
import { Terminal } from "./actions/terminal.js";
import { Prompt } from "./actions/prompt.js";
import { NextAgentPage, PreviousAgentPage } from "./actions/page-navigation.js";
import { ClosePane, SplitPane, SwapPane } from "./actions/pane-control.js";
import { Quota } from "./actions/quota.js";
import { SendKeys } from "./actions/send-keys.js";
import { DEFAULT_SOCKET_PATH } from "./constants.js";
import { HerdrStore } from "./herdr/store.js";
import type { GlobalSettings } from "./settings.js";
import { QuotaStore } from "./quota/store.js";
import { FavoritesStore } from "./favorites.js";
import { bringTerminalToFront } from "./platform/foreground.js";

const store = new HerdrStore({
  socketPath: DEFAULT_SOCKET_PATH,
  log: (message, error) =>
    error === undefined ? streamDeck.logger.info(message) : streamDeck.logger.warn(message, error),
});
const pager = new AgentPager(8);
const quotaStore = new QuotaStore();
const favorites = new FavoritesStore();
let pluginSettings: GlobalSettings = {};

const persistSettings = async (patch: Partial<GlobalSettings>): Promise<void> => {
  pluginSettings = { ...pluginSettings, ...patch };
  await streamDeck.settings.setGlobalSettings(pluginSettings);
};
const persistFavorites = (ids: string[]): Promise<void> => persistSettings({ favoriteSessions: ids });
const socketPathFor = (settings: GlobalSettings): string =>
  settings.socketPath ?? (settings.sessionName === undefined
    ? DEFAULT_SOCKET_PATH
    : join(homedir(), ".config", "herdr", "sessions", settings.sessionName, "herdr.sock"));

streamDeck.actions.registerAction(new AgentSlot(
  store,
  pager,
  () => favorites.ids,
  () => bringTerminalToFront(pluginSettings.terminalApp ?? "iTerm2", pluginSettings.terminalMatch ?? "herdr"),
));
streamDeck.actions.registerAction(new SendKeys(store));
streamDeck.actions.registerAction(new Prompt(store));
streamDeck.actions.registerAction(new PreviousAgentPage(store, pager, () => favorites.ids));
streamDeck.actions.registerAction(new NextAgentPage(store, pager, () => favorites.ids));
streamDeck.actions.registerAction(new SplitPane(store));
streamDeck.actions.registerAction(new SwapPane(store));
streamDeck.actions.registerAction(new ClosePane(store));
streamDeck.actions.registerAction(new Quota(quotaStore, store));
streamDeck.actions.registerAction(new AgentQueue(store, pager));
streamDeck.actions.registerAction(new AgentView(store, pager, () => favorites.ids));
streamDeck.actions.registerAction(new WorkspacePage(store, pager));
streamDeck.actions.registerAction(new Favorite(store, favorites, persistFavorites));
streamDeck.actions.registerAction(new Health(store, quotaStore));
streamDeck.actions.registerAction(new Recovery(store));
streamDeck.actions.registerAction(new Session(store, (name) => persistSettings({ sessionName: name })));
streamDeck.actions.registerAction(new Terminal());

await streamDeck.connect();

// globalSettings は接続後でないと取れないため、既定パスで作ってから差し替える。
pluginSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
favorites.replace(pluginSettings.favoriteSessions ?? []);
favorites.subscribe(() => pager.refresh());
store.setSocketPath(socketPathFor(pluginSettings));
store.start();
let previousFocusedPaneId: string | null | undefined;
let previousAgentPaneIds: Set<string> | undefined;
store.subscribe((state) => {
  if (state.status !== "online") {
    pager.clamp(0);
    previousFocusedPaneId = undefined;
    previousAgentPaneIds = undefined;
    return;
  }

  const { snapshot } = state;
  pager.clamp(snapshot.agents.length);
  const currentAgentPaneIds = new Set(snapshot.agents.map((agent) => agent.paneId));
  const focusedPaneIsNew =
    previousAgentPaneIds !== undefined &&
    snapshot.focusedPaneId !== null &&
    !previousAgentPaneIds.has(snapshot.focusedPaneId);
  if (
    snapshot.focusedPaneId !== null &&
    snapshot.focusedPaneId !== previousFocusedPaneId
    && !focusedPaneIsNew
  ) {
    const index = pager.visibleAgents(snapshot, favorites.ids).findIndex(
      (agent) => agent.paneId === snapshot.focusedPaneId,
    );
    if (index >= 0) pager.showAbsoluteIndex(index + 1, pager.visibleAgents(snapshot, favorites.ids).length);
  }
  previousFocusedPaneId = snapshot.focusedPaneId;
  previousAgentPaneIds = currentAgentPaneIds;
});

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
  pluginSettings = ev.settings;
  favorites.replace(ev.settings.favoriteSessions ?? []);
  store.setSocketPath(socketPathFor(ev.settings));
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
