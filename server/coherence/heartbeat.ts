/**
 * Heartbeat Scanner
 *
 * Detects active Claude Code sessions via process inspection.
 * Writes live-state.json with current session info.
 *
 * On macOS:
 * - pgrep -x "claude" finds PIDs
 * - lsof -p $pid | grep cwd gets working directory
 * - ps -p $pid -o args= gets command line
 * - ps -p $pid -o lstart= gets start time
 */

import { execSync } from "child_process";
import { writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const SKEIN_DIR = join(homedir(), ".claude", "skein");
const SESSIONS_DIR = join(homedir(), ".claude", "sessions");

export interface ActiveSession {
  pid: number;
  tty: string;
  projectDirectory: string;
  projectName: string;
  command: string;
  startedAt: string;
  resumeId?: string;
  /** Claude Code sessionId from ~/.claude/sessions/<pid>.json — stable across --resume */
  sessionId?: string;
  /**
   * Last real activity from the registry's `updatedAt` (ISO). This is the
   * "most recently active" axis (see CONTEXT.md) — distinct from `startedAt`
   * (process birth). Absent when there's no registry entry.
   */
  updatedAt?: string;
}

export interface LiveState {
  lastScan: string;
  activeSessions: ActiveSession[];
  projectSummary: Record<string, { sessionCount: number; directories: string[] }>;
}

/** Derive a human-readable project name from a CWD path */
function deriveProjectName(cwd: string): string {
  // Strip common prefixes
  let name = cwd
    .replace(/^.*com~apple~CloudDocs\//, "")
    .replace(/^.*CloudDocs\//, "")
    .replace(/^.*Documents\//, "");

  // Convert path segments to title
  return name
    .split("/")
    .map((seg) =>
      seg
        .replace(/[_-]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    )
    .join(": ");
}

/** Get full path from lsof cwd output (prepends home dir if relative) */
function resolveFullPath(cwdFromLsof: string): string {
  if (cwdFromLsof.startsWith("/")) return cwdFromLsof;
  return join(homedir(), cwdFromLsof);
}

/** Scan for active Claude Code sessions */
export async function scanActiveSessions(): Promise<LiveState> {
  const sessions: ActiveSession[] = [];

  try {
    // Find all claude PIDs
    const pidsRaw = execSync('pgrep -x "claude"', { encoding: "utf-8" }).trim();
    if (!pidsRaw) return { lastScan: new Date().toISOString(), activeSessions: [], projectSummary: {} };

    const pids = pidsRaw.split("\n").map((p) => parseInt(p.trim(), 10)).filter(Boolean);

    for (const pid of pids) {
      try {
        // Get working directory
        const lsofOut = execSync(`lsof -p ${pid} 2>/dev/null | grep cwd`, {
          encoding: "utf-8",
        }).trim();
        const cwd = lsofOut.split(/\s+/).pop() ?? "";
        if (!cwd) continue;

        // Get command line
        const cmd = execSync(`ps -p ${pid} -o args= 2>/dev/null`, {
          encoding: "utf-8",
        }).trim();

        // Skip non-interactive claude processes (--print, subagents)
        if (cmd.includes("--print") || cmd.includes("--output-format")) continue;

        // Get TTY
        const tty = execSync(`ps -p ${pid} -o tty= 2>/dev/null`, {
          encoding: "utf-8",
        }).trim();

        // Get start time
        const startedRaw = execSync(`ps -p ${pid} -o lstart= 2>/dev/null`, {
          encoding: "utf-8",
        }).trim();

        // Extract resume/session ID if present
        let resumeId: string | undefined;
        const resumeMatch = cmd.match(/(?:--resume|-r)\s+([a-f0-9-]+)/);
        if (resumeMatch) resumeId = resumeMatch[1];

        const fullPath = resolveFullPath(cwd);

        // sessionId + last-activity from Claude Code's registry (keyed by pid).
        // sessionId is stable across --resume; updatedAt is the recency axis.
        let sessionId: string | undefined;
        let updatedAt: string | undefined;
        try {
          const reg = JSON.parse(
            await readFile(join(SESSIONS_DIR, `${pid}.json`), "utf-8")
          );
          if (reg?.sessionId) sessionId = reg.sessionId as string;
          // Registry stamps updatedAt as epoch ms (see thread-capture.ts).
          if (typeof reg?.updatedAt === "number") {
            updatedAt = new Date(reg.updatedAt).toISOString();
          }
        } catch {
          // No registry entry — leave sessionId/updatedAt undefined
        }

        sessions.push({
          pid,
          tty,
          projectDirectory: fullPath,
          projectName: deriveProjectName(cwd),
          command: cmd.length > 120 ? cmd.slice(0, 120) + "..." : cmd,
          startedAt: startedRaw ? new Date(startedRaw).toISOString() : "",
          resumeId,
          sessionId,
          updatedAt,
        });
      } catch {
        // Skip processes we can't inspect
      }
    }
  } catch {
    // pgrep returns non-zero if no matches
  }

  // Ensure a notes vault FOLDER exists for every live working directory.
  // Folder-only (no Obsidian registration — that waits for the first saved
  // note). Idempotent and non-fatal: a failure here must never break a scan.
  {
    const { ensureVault } = await import("./notepads");
    const uniqueDirs = [...new Set(sessions.map((s) => s.projectDirectory))];
    await Promise.all(
      uniqueDirs.map((d) => ensureVault(d).catch(() => {}))
    );
  }

  // Kick off Haiku session-title generation (#32) — fire-and-forget, capped,
  // once per session. Never awaited: titles appear on a later poll.
  try {
    const { ensureTitles } = await import("./session-titles");
    void ensureTitles(sessions);
  } catch {
    // title generation is best-effort
  }

  // Build project summary (group by directory)
  const projectSummary: Record<string, { sessionCount: number; directories: string[] }> = {};
  for (const session of sessions) {
    const name = session.projectName;
    if (!projectSummary[name]) {
      projectSummary[name] = { sessionCount: 0, directories: [] };
    }
    projectSummary[name].sessionCount++;
    if (!projectSummary[name].directories.includes(session.projectDirectory)) {
      projectSummary[name].directories.push(session.projectDirectory);
    }
  }

  const liveState: LiveState = {
    lastScan: new Date().toISOString(),
    activeSessions: sessions,
    projectSummary,
  };

  // Write to disk
  await mkdir(SKEIN_DIR, { recursive: true });
  await writeFile(
    join(SKEIN_DIR, "live-state.json"),
    JSON.stringify(liveState, null, 2),
    "utf-8"
  );

  return liveState;
}
