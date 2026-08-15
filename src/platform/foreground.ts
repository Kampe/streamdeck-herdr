import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type TerminalApp = "iTerm2" | "Terminal" | "WezTerm";
export type OsascriptRunner = (args: readonly string[]) => Promise<void>;
export type WakeRunner = () => Promise<void>;

function iTermScript(match: string): string {
  const escaped = match.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `tell application "iTerm2"
  set targetWindow to missing value
  set targetTab to missing value
  set targetSession to missing value
  repeat with candidateWindow in windows
    repeat with candidateTab in tabs of candidateWindow
      repeat with candidateSession in sessions of candidateTab
        set sessionName to name of candidateSession
        if sessionName contains "${escaped}" or sessionName contains "tmux" then
          set targetWindow to candidateWindow
          set targetTab to candidateTab
          set targetSession to candidateSession
          exit repeat
        end if
      end repeat
      if targetSession is not missing value then exit repeat
    end repeat
    if targetSession is not missing value then exit repeat
  end repeat
  if targetSession is not missing value then
    set index of targetWindow to 1
    select targetTab
    select targetSession
  end if
  activate
end tell`;
}

function simpleTerminalScript(app: "Terminal" | "WezTerm", match: string): string {
  const escaped = match.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `tell application "${app}"
  activate
  repeat with candidateWindow in windows
    if (name of candidateWindow contains "${escaped}") then
      set index of candidateWindow to 1
      exit repeat
    end if
  end repeat
end tell`;
}

async function runOsascript(args: readonly string[]): Promise<void> {
  await execFileAsync("/usr/bin/osascript", [...args], { timeout: 1_500, maxBuffer: 32 * 1024 });
}

/** Reset macOS display-idle state without injecting a key into a live agent. */
async function wakeDisplay(): Promise<void> {
  await execFileAsync("/usr/bin/caffeinate", ["-u", "-t", "2"], { timeout: 2_500 });
}

/** Bring a supported terminal forward without injecting keys. */
export async function bringTerminalToFront(
  app: TerminalApp = "iTerm2",
  match = "herdr",
  run: OsascriptRunner = runOsascript,
  wake: WakeRunner = wakeDisplay,
): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    await wake();
    await run(["-e", app === "iTerm2" ? iTermScript(match) : simpleTerminalScript(app, match)]);
    return true;
  } catch {
    return false;
  }
}

export const bringITermToFront = (run?: OsascriptRunner, wake?: WakeRunner): Promise<boolean> =>
  bringTerminalToFront("iTerm2", "herdr", run, wake);
