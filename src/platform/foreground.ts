import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ITERM_ACTIVATE_SCRIPT = 'tell application "iTerm2" to activate';

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

