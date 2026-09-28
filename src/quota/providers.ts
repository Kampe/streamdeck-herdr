import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

/**
 * Native quota fetchers: read each tool's own local credentials and ask its
 * provider for usage, the same way OpenUsage does. No helper app, no
 * herdr-quota/herd pipeline in between.
 *
 * Endpoints and response shapes are the ones Herdforge's pkg/usage verified
 * against live responses (ported from OpenUsage's providers):
 *   claude       GET  api.anthropic.com/api/oauth/usage
 *   codex        GET  chatgpt.com/backend-api/wham/usage
 *   antigravity  POST cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary
 *   grok         GET  cli-chat-proxy.grok.com/v1/billing?format=credits
 *
 * Every fetcher is read-only: it never refreshes or writes credentials. A
 * missing or expired login is an error naming the CLI to log in with, never a
 * fabricated zero (a zero reads as "plenty of quota").
 */

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 10_000;
const USER_AGENT = "streamdeck-herdr/quota";

// Node races IPv6/IPv4 with a 250ms per-attempt budget. On a network with no
// working IPv6 and a slower IPv4 handshake every attempt times out
// (AggregateError ETIMEDOUT) while curl connects fine; give each family a
// realistic window instead.
setDefaultAutoSelectFamilyAttemptTimeout(2_000);

/** One usage window, in percent of its limit (0-100). */
export type Window = {
  name: string;
  used: number;
  resetsAt?: string;
  windowSeconds?: number;
};

export class QuotaError extends Error {}

export type Fetcher = () => Promise<Window[]>;

type HttpResult = { status: number; body: string };

function httpJson(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<HttpResult> {
  const target = new URL(url);
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      target,
      {
        method: init.method ?? "GET",
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...init.headers },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("timeout", () => req.destroy(new QuotaError(`timed out: ${target.host}`)));
    req.on("error", reject);
    if (init.body !== undefined) {
      req.write(init.body);
    }
    req.end();
  });
}

function checkStatus(what: string, res: HttpResult): unknown {
  if (res.status === 429) {
    throw new QuotaError(`${what}: rate limited`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new QuotaError(`${what}: login expired (${res.status})`);
  }
  if (res.status !== 200) {
    throw new QuotaError(`${what}: HTTP ${res.status}`);
  }
  return JSON.parse(res.body) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

async function readJsonFirst(paths: string[]): Promise<{ path: string; value: unknown } | null> {
  for (const path of paths) {
    try {
      return { path, value: JSON.parse(await readFile(path, "utf8")) as unknown };
    } catch {
      // Missing or unreadable: try the next location the CLI uses.
    }
  }
  return null;
}

function configDirs(envVar: string, xdgName: string, dotName: string): string[] {
  const home = homedir();
  return [
    process.env[envVar],
    process.env.XDG_CONFIG_HOME === undefined ? undefined : join(process.env.XDG_CONFIG_HOME, xdgName),
    join(home, dotName),
    join(home, ".config", xdgName),
  ].filter((dir): dir is string => dir !== undefined && dir.trim() !== "");
}

// ---------- claude ----------

export function claudeTokenFrom(value: unknown, now = Date.now()): string {
  const oauth = isRecord(value) && isRecord(value.claudeAiOauth) ? value.claudeAiOauth : undefined;
  const token = str(oauth?.accessToken);
  if (token === undefined) {
    throw new QuotaError("claude: no access token; log in with the claude CLI");
  }
  const expiresAt = num(oauth?.expiresAt);
  if (expiresAt !== undefined && expiresAt > 0 && now > expiresAt) {
    throw new QuotaError("claude: login expired; run claude to refresh it");
  }
  return token;
}

async function claudeToken(): Promise<string> {
  const file = await readJsonFirst(configDirs("CLAUDE_CONFIG_DIR", "claude", ".claude").map((d) => join(d, ".credentials.json")));
  if (file !== null) {
    return claudeTokenFrom(file.value);
  }
  if (process.platform !== "darwin") {
    throw new QuotaError("claude: no credentials file; log in with the claude CLI");
  }
  try {
    // Claude Code keeps its OAuth login in the login keychain on macOS.
    const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], {
      timeout: 5_000,
    });
    return claudeTokenFrom(JSON.parse(stdout.trim()));
  } catch (error) {
    if (error instanceof QuotaError) {
      throw error;
    }
    throw new QuotaError("claude: no credentials in file or keychain; log in with the claude CLI");
  }
}

export function claudeWindows(value: unknown): Window[] {
  if (!isRecord(value)) {
    return [];
  }
  const windows: Window[] = [];
  const add = (name: string, w: unknown, windowSeconds: number) => {
    if (isRecord(w) && num(w.utilization) !== undefined) {
      windows.push({ name, used: num(w.utilization)!, resetsAt: str(w.resets_at), windowSeconds });
    }
  };
  add("session", value.five_hour, 5 * 3600);
  add("weekly", value.seven_day, 7 * 86400);
  add("sonnetWeekly", value.seven_day_sonnet, 7 * 86400);
  // Per-model weekly pools (Fable) exist only in `limits`.
  if (Array.isArray(value.limits)) {
    for (const limit of value.limits) {
      if (!isRecord(limit) || limit.kind !== "weekly_scoped" || num(limit.percent) === undefined) {
        continue;
      }
      const model = isRecord(limit.scope) && isRecord(limit.scope.model) ? str(limit.scope.model.display_name) : undefined;
      if (model !== undefined) {
        windows.push({ name: `${model.toLowerCase()}Weekly`, used: num(limit.percent)!, resetsAt: str(limit.resets_at), windowSeconds: 7 * 86400 });
      }
    }
  }
  return windows;
}

export const fetchClaude: Fetcher = async () => {
  const token = await claudeToken();
  const res = await httpJson("https://api.anthropic.com/api/oauth/usage", {
    headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
  });
  return claudeWindows(checkStatus("claude usage", res));
};

// ---------- codex ----------

async function codexAuth(): Promise<{ token: string; account?: string }> {
  const dirs = [process.env.CODEX_HOME, join(homedir(), ".config", "codex"), join(homedir(), ".codex")].filter(
    (d): d is string => d !== undefined && d.trim() !== "",
  );
  const file = await readJsonFirst(dirs.map((d) => join(d, "auth.json")));
  const tokens = file !== null && isRecord(file.value) && isRecord(file.value.tokens) ? file.value.tokens : undefined;
  const token = str(tokens?.access_token);
  if (token === undefined) {
    throw new QuotaError("codex: no ChatGPT login (an API key cannot read plan quota); run codex login");
  }
  return { token, account: str(tokens?.account_id) };
}

function codexPoolKey(limitName: string): string {
  const name = limitName.trim().toLowerCase();
  const dash = name.lastIndexOf("-");
  return dash >= 0 && dash + 1 < name.length ? name.slice(dash + 1) : name;
}

export function codexWindows(value: unknown): Window[] {
  if (!isRecord(value)) {
    return [];
  }
  const windows: Window[] = [];
  const add = (name: string, w: unknown) => {
    if (!isRecord(w) || num(w.used_percent) === undefined) {
      return;
    }
    const resetAt = num(w.reset_at);
    windows.push({
      name,
      used: num(w.used_percent)!,
      resetsAt: resetAt !== undefined && resetAt > 0 ? new Date(resetAt * 1000).toISOString() : undefined,
      windowSeconds: num(w.limit_window_seconds),
    });
  };
  const rateLimit = isRecord(value.rate_limit) ? value.rate_limit : {};
  // primary is the plan's long (weekly) window; secondary the short burst one.
  add("weekly", rateLimit.primary_window);
  add("session", rateLimit.secondary_window);
  // Per-model pools (Spark) exist only in additional_rate_limits.
  if (Array.isArray(value.additional_rate_limits)) {
    for (const extra of value.additional_rate_limits) {
      if (!isRecord(extra) || str(extra.limit_name) === undefined || !isRecord(extra.rate_limit)) {
        continue;
      }
      const key = codexPoolKey(str(extra.limit_name)!);
      add(`${key}Weekly`, extra.rate_limit.primary_window);
      add(`${key}Session`, extra.rate_limit.secondary_window);
    }
  }
  return windows;
}

export const fetchCodex: Fetcher = async () => {
  const { token, account } = await codexAuth();
  const res = await httpJson("https://chatgpt.com/backend-api/wham/usage", {
    headers: { Authorization: `Bearer ${token}`, ...(account === undefined ? {} : { "ChatGPT-Account-Id": account }) },
  });
  return codexWindows(checkStatus("codex usage", res));
};

// ---------- antigravity ----------

const ANTIGRAVITY_BUCKETS: Record<string, string> = {
  "gemini-5h": "geminiSession",
  "gemini-weekly": "geminiWeekly",
  "3p-5h": "nonGeminiSession",
  "3p-weekly": "nonGeminiWeekly",
};

export function antigravityWindows(value: unknown): Window[] {
  const windows: Window[] = [];
  const groups = isRecord(value) && Array.isArray(value.groups) ? value.groups : [];
  for (const group of groups) {
    const buckets = isRecord(group) && Array.isArray(group.buckets) ? group.buckets : [];
    for (const bucket of buckets) {
      if (!isRecord(bucket)) {
        continue;
      }
      const name = ANTIGRAVITY_BUCKETS[String(bucket.bucketId)];
      const fraction = num(bucket.remainingFraction);
      if (name === undefined || fraction === undefined || fraction < 0 || fraction > 1) {
        continue;
      }
      windows.push({
        name,
        used: (1 - fraction) * 100,
        resetsAt: str(bucket.resetTime),
        windowSeconds: name.endsWith("Session") ? 5 * 3600 : 7 * 86400,
      });
    }
  }
  return windows;
}

/**
 * Antigravity's own language server (IDE or agy CLI) gets these buckets from
 * Cloud Code's retrieveUserQuotaSummary; call it directly with the agy CLI's
 * stored Google login. Same buckets agy's /usage shows: Gemini and non-Gemini
 * (Claude/GPT), each with a 5h and a weekly window.
 */
const AGY_TOKEN_FILE = join(homedir(), ".gemini", "antigravity-cli", "antigravity-oauth-token");

export function antigravityTokenFrom(value: unknown, now = Date.now()): string {
  const token = isRecord(value) && isRecord(value.token) ? value.token : undefined;
  const access = str(token?.access_token);
  if (access === undefined) {
    throw new QuotaError("antigravity: no login; sign in with agy");
  }
  const expiry = str(token?.expiry);
  if (expiry !== undefined && Date.parse(expiry) < now) {
    // agy refreshes this file while it runs; the plugin never refreshes tokens.
    throw new QuotaError("antigravity: login expired; open agy to refresh it");
  }
  return access;
}

export const fetchAntigravity: Fetcher = async () => {
  const file = await readJsonFirst([AGY_TOKEN_FILE]);
  if (file === null) {
    throw new QuotaError("antigravity: no agy login found; sign in with agy");
  }
  const token = antigravityTokenFrom(file.value);
  const res = await httpJson("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary", {
    method: "POST",
    // Cloud Code rejects unknown clients with 403; identify as the agy client.
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "antigravity" },
    body: "{}",
  });
  return antigravityWindows(checkStatus("antigravity quota", res));
};

// ---------- grok ----------

export function grokWindows(value: unknown): Window[] {
  if (!isRecord(value)) {
    return [];
  }
  const config = isRecord(value.config) ? value.config : undefined;
  const period = config !== undefined && isRecord(config.currentPeriod) ? config.currentPeriod : undefined;
  if (period !== undefined && String(period.type).includes("WEEKLY")) {
    // proto3: an omitted creditUsagePercent is a genuine zero.
    return [{ name: "weekly", used: num(config?.creditUsagePercent) ?? 0, resetsAt: str(period.end), windowSeconds: 7 * 86400 }];
  }
  const total = num(value.total);
  const used = num(value.used);
  if (total !== undefined && total > 0 && used !== undefined) {
    return [{ name: "weekly", used: (used / total) * 100 }];
  }
  return [];
}

export const fetchGrok: Fetcher = async () => {
  const file = await readJsonFirst([join(homedir(), ".grok", "auth.json")]);
  const entries = file !== null && isRecord(file.value) ? Object.values(file.value) : [];
  if (entries.length > 1) {
    throw new QuotaError("grok: auth.json has several accounts; refusing to guess which one");
  }
  const token = entries.length === 1 && isRecord(entries[0]) ? str(entries[0].key) : undefined;
  if (token === undefined) {
    throw new QuotaError("grok: no login; run grok login");
  }
  const res = await httpJson("https://cli-chat-proxy.grok.com/v1/billing?format=credits", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return grokWindows(checkStatus("grok billing", res));
};

export const FETCHERS: Record<string, Fetcher> = {
  claude: fetchClaude,
  codex: fetchCodex,
  antigravity: fetchAntigravity,
  grok: fetchGrok,
};
