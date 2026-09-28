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
 *   antigravity  POST <IDE language server>/…/RetrieveUserQuotaSummary, else
 *                POST cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels
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
  init: { method?: string; headers?: Record<string, string>; body?: string; insecureLocal?: boolean } = {},
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
        // Only the Antigravity language server on 127.0.0.1 uses a self-signed cert.
        ...(init.insecureLocal === true && target.hostname === "127.0.0.1" ? { rejectUnauthorized: false } : {}),
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

function flagValue(fields: string[], flag: string): string | undefined {
  for (let i = 0; i < fields.length; i += 1) {
    if (fields[i] === flag && i + 1 < fields.length) {
      return fields[i + 1];
    }
    if (fields[i].startsWith(`${flag}=`)) {
      return fields[i].slice(flag.length + 1);
    }
  }
  return undefined;
}

/** Antigravity serves quota from its own language server; find the running one. */
async function discoverAntigravity(): Promise<{ csrf: string; urls: string[] }> {
  const { stdout } = await execFileAsync("ps", ["-ax", "-o", "pid=,command="], { timeout: 5_000, maxBuffer: 8 * 1024 * 1024 });
  for (const line of stdout.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 2) {
      continue;
    }
    const command = fields.slice(1).join(" ").toLowerCase();
    // Only the IDE's language server carries its CSRF token on the command
    // line. The agy CLI serves the same endpoint but keeps its token in
    // memory, so probing it only ever returns 401 "missing CSRF token".
    if (!command.includes("language_server")) {
      continue;
    }
    if (command.includes("--app_data_dir") && !command.includes("antigravity")) {
      continue;
    }
    const csrf = flagValue(fields, "--csrf_token");
    if (csrf === undefined || csrf === "") {
      continue;
    }
    const urls: string[] = [];
    try {
      const { stdout: lsof } = await execFileAsync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", fields[0]], { timeout: 5_000 });
      const ports = new Set<number>();
      for (const match of lsof.matchAll(/:(\d+) \(LISTEN\)/g)) {
        ports.add(Number(match[1]));
      }
      for (const port of ports) {
        urls.push(`https://127.0.0.1:${port}`, `http://127.0.0.1:${port}`);
      }
    } catch {
      // No lsof result; the extension port below may still work.
    }
    const extension = Number(flagValue(fields, "--extension_server_port") ?? "0");
    if (extension > 0) {
      urls.push(`http://127.0.0.1:${extension}`);
    }
    if (urls.length > 0) {
      return { csrf, urls };
    }
  }
  throw new QuotaError("antigravity: IDE language server is not running");
}

// Cloud fallback: the agy CLI's own Google OAuth token against Cloud Code,
// which reports a remaining fraction per model on a ~5h window.
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

/** Group per-model Cloud Code quota into the Gemini and non-Gemini pools. */
export function antigravityModelWindows(value: unknown): Window[] {
  const models = isRecord(value) && isRecord(value.models) ? value.models : {};
  const pools: Record<"geminiSession" | "nonGeminiSession", { used: number; resetsAt?: string } | undefined> = {
    geminiSession: undefined,
    nonGeminiSession: undefined,
  };
  for (const [id, model] of Object.entries(models)) {
    if (!isRecord(model) || !isRecord(model.quotaInfo)) {
      continue;
    }
    const fraction = num(model.quotaInfo.remainingFraction);
    const resetsAt = str(model.quotaInfo.resetTime);
    // Internal completion/tab models carry no reset window; they are not chat quota.
    if (fraction === undefined || fraction < 0 || fraction > 1 || resetsAt === undefined) {
      continue;
    }
    const provider = String(model.modelProvider ?? "");
    const gemini = provider === "MODEL_PROVIDER_GOOGLE" ? id.startsWith("gemini") : false;
    if (provider === "MODEL_PROVIDER_GOOGLE" && !gemini) {
      continue;
    }
    const key = gemini ? "geminiSession" : "nonGeminiSession";
    const used = (1 - fraction) * 100;
    const current = pools[key];
    // A pool is only as healthy as its most-spent model.
    if (current === undefined || used > current.used) {
      pools[key] = { used, resetsAt };
    }
  }
  return (Object.entries(pools) as [string, { used: number; resetsAt?: string } | undefined][])
    .filter((entry): entry is [string, { used: number; resetsAt?: string }] => entry[1] !== undefined)
    .map(([name, pool]) => ({ name, used: pool.used, resetsAt: pool.resetsAt, windowSeconds: 5 * 3600 }));
}

async function fetchAntigravityCloud(): Promise<Window[]> {
  const file = await readJsonFirst([AGY_TOKEN_FILE]);
  if (file === null) {
    throw new QuotaError("antigravity: no agy login found; sign in with agy");
  }
  const token = antigravityTokenFrom(file.value);
  const res = await httpJson("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels", {
    method: "POST",
    // Cloud Code rejects unknown clients with 403; identify as the agy client.
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "antigravity" },
    body: "{}",
  });
  return antigravityModelWindows(checkStatus("antigravity quota", res));
}

async function fetchAntigravityLocal(): Promise<Window[]> {
  const { csrf, urls } = await discoverAntigravity();
  let lastError: unknown = new QuotaError("antigravity: no usable port");
  for (const base of urls) {
    try {
      const res = await httpJson(`${base}/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-codeium-csrf-token": csrf },
        body: "{}",
        insecureLocal: true,
      });
      const windows = antigravityWindows(checkStatus("antigravity quota", res));
      if (windows.length > 0) {
        return windows;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * The IDE's language server reports both 5h and weekly buckets, so it wins
 * when it is running; otherwise the agy CLI's login answers from the cloud.
 */
export const fetchAntigravity: Fetcher = async () => {
  try {
    return await fetchAntigravityLocal();
  } catch {
    return fetchAntigravityCloud();
  }
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
