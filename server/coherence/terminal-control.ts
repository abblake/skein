/**
 * Terminal Control — P3 of the Parking Lot (see Plans/parking-lot.md)
 *
 * The trust bet: clicking a card either focuses the live window or resumes the
 * closed session. Two distinct behaviors because a *live* session cannot be
 * `--resume`d (one live instance per session).
 *
 * VERIFIED on Apple Terminal (2026-05-20):
 * - `tty of tab` (AppleScript) joins exactly to `ps -o tty=` → window focus works.
 * - `do script "cd … && claude --resume <uuid>"` opens a resumed session.
 *
 * SAFETY: callers pass only values that came from threads.json (server-owned),
 * never raw client input. We still validate UUID shape and single-quote the
 * directory so a path can never break out of the shell command.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTY_RE = /^\/dev\/ttys[0-9]+$/;

/** Single-quote a string for safe use inside a POSIX shell command. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function osascript(script: string): Promise<string> {
  const { stdout } = await run("osascript", ["-e", script], { timeout: 8000 });
  return stdout.trim();
}

/** Bring the Terminal window whose active tab has this tty to the front. */
export async function focusWindowByTty(tty: string): Promise<{ ok: boolean; detail: string }> {
  if (!TTY_RE.test(tty)) return { ok: false, detail: `invalid tty: ${tty}` };
  const script = `
tell application "Terminal"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      if (tty of t) is "${tty}" then
        set selected of t to true
        set index of w to 1
        return "ok"
      end if
    end repeat
  end repeat
end tell
return "notfound"`;
  const result = await osascript(script);
  return result === "ok"
    ? { ok: true, detail: "focused" }
    : { ok: false, detail: "window not found (already closed?)" };
}

/** Open a new Terminal window and resume the session by UUID in its directory. */
export async function resumeSession(dir: string, uuid: string): Promise<{ ok: boolean; detail: string }> {
  if (!UUID_RE.test(uuid)) return { ok: false, detail: `invalid uuid: ${uuid}` };
  const cmd = `cd ${shQuote(dir)} && claude --resume ${uuid}`;
  // Escape for embedding inside the AppleScript double-quoted string.
  const escaped = cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `
tell application "Terminal"
  activate
  do script "${escaped}"
end tell
return "ok"`;
  await osascript(script);
  return { ok: true, detail: "resuming in new window" };
}
