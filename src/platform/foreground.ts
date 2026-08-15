import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ITERM_ACTIVATE_SCRIPT = `tell application "iTerm2"
  set targetWindow to missing value
  set targetTab to missing value
  set targetSession to missing value
  repeat with candidateWindow in windows
    repeat with candidateTab in tabs of candidateWindow
      repeat with candidateSession in sessions of candidateTab
        set sessionName to name of candidateSession
        if sessionName contains "herdr" or sessionName contains "tmux" then
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
    set selected tab of targetWindow to targetTab
    set current session of targetTab to targetSession
  end if
  activate
end tell`;

export type OsascriptRunner = (args: readonly string[]) => Promise<void>;

async function runOsascript(args: readonly string[]): Promise<void> {
  await execFileAsync("/usr/bin/osascript", [...args], {
    timeout: 1_500,
    maxBuffer: 32 * 1024,
  });
}

/** Bring the iTerm2 app forward without injecting keys or changing pane state. */
export async function bringITermToFront(run: OsascriptRunner = runOsascript): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }

  try {
    await run(["-e", ITERM_ACTIVATE_SCRIPT]);
    return true;
  } catch {
    // App missing or Automation permission denied. Herdr focus must still work.
    return false;
  }
}
