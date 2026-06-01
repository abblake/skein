/**
 * Project Scanner
 *
 * Builds a unified project list by merging three data sources:
 * 1. Active Claude sessions (from heartbeat/process inspection)
 * 2. Project directories (dirs with .claude/ configs)
 * 3. PRD sessions (from PAI's MEMORY/WORK/)
 *
 * Projects are identified by directory path.
 */

import { execSync } from "child_process";
import { readdir, readFile, stat } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";
import matter from "gray-matter";
import { enrichProject, type Enrichment } from "./project-enrichment";

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const MEMORY_WORK = join(CLAUDE_DIR, "MEMORY", "WORK");

/**
 * Directories Skein scans for project folders (those containing a `.claude/`).
 * Config-driven via SKEIN_SCAN_ROOTS (colon-separated absolute paths). When
 * unset, defaults to the user's home dir plus the common synced-drive location
 * (iCloud Drive's container) IF it exists — derived from homedir(), never a
 * hardcoded username/path. See .env.example.
 */
function scanRoots(): string[] {
  const fromEnv = (process.env.SKEIN_SCAN_ROOTS ?? "")
    .split(":")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (fromEnv.length > 0) return [...new Set(fromEnv)];

  const defaults = [HOME];
  const icloud = join(HOME, "Library", "Mobile Documents", "com~apple~CloudDocs");
  defaults.push(icloud);
  return [...new Set(defaults)];
}

export interface SkeinProject {
  id: string;                    // Derived from directory path
  name: string;                  // Human-readable name
  directory: string;             // Full path
  activeSessions: number;        // Live Claude processes
  activeSessionDetails: Array<{
    pid: number;
    tty: string;
    startedAt: string;
    command: string;
  }>;
  prdCount: number;              // Related PRD sessions
  recentPrds: Array<{
    slug: string;
    task: string;
    phase: string;
    progress: string;
    updated: string;
  }>;
  totalClaudeSessions: number;   // Real count from JSONL logs
  claudeProjectId: string;       // Mangled project dir name for session API
  recentSessionPreviews: Array<{
    uuid: string;
    firstUserMessage: string;
    lastMessageAt: string;
  }>;
  lastActivity: string;          // Most recent timestamp
  hasClaudeConfig: boolean;      // Has .claude/ directory
  relativeDir: string;           // ~-prefixed path for display
  enrichment: Enrichment;        // Telos/adhd-plan/git/README/stats join
}

/** Derive a clean project name from a directory path */
function deriveProjectName(dir: string): string {
  const name = basename(dir);
  return name
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Create a stable ID from a directory path */
function dirToId(dir: string): string {
  return dir
    .replace(HOME, "")
    .replace(/\//g, "-")
    .replace(/^-/, "")
    .replace(/[~\s]/g, "_");
}

/** Scan active Claude processes and return grouped by CWD */
function scanActiveProcesses(): Map<string, Array<{ pid: number; tty: string; startedAt: string; command: string }>> {
  const byDir = new Map<string, Array<{ pid: number; tty: string; startedAt: string; command: string }>>();

  try {
    const pidsRaw = execSync('pgrep -x "claude"', { encoding: "utf-8" }).trim();
    if (!pidsRaw) return byDir;

    for (const pidStr of pidsRaw.split("\n")) {
      const pid = parseInt(pidStr.trim(), 10);
      if (!pid) continue;

      try {
        const lsofOut = execSync(`lsof -p ${pid} 2>/dev/null | grep cwd`, { encoding: "utf-8" }).trim();
        // lsof cwd line format:
        //   COMMAND PID USER FD TYPE DEVICE SIZE NODE NAME
        // NAME (the absolute path) starts at column 9. Paths can contain
        // spaces (e.g. "Library/Mobile Documents/..."), so joining tokens 9+
        // preserves them. Plain split().pop() truncates at the first space.
        const parts = lsofOut.split(/\s+/);
        let cwd = parts.slice(8).join(" ").trim();
        if (!cwd) continue;

        // Resolve to full path
        if (!cwd.startsWith("/")) cwd = join(HOME, cwd);

        const cmd = execSync(`ps -p ${pid} -o args= 2>/dev/null`, { encoding: "utf-8" }).trim();
        if (cmd.includes("--print") || cmd.includes("--output-format")) continue;

        const tty = execSync(`ps -p ${pid} -o tty= 2>/dev/null`, { encoding: "utf-8" }).trim();
        const startedRaw = execSync(`ps -p ${pid} -o lstart= 2>/dev/null`, { encoding: "utf-8" }).trim();

        const entry = {
          pid,
          tty,
          startedAt: startedRaw ? new Date(startedRaw).toISOString() : "",
          command: cmd.length > 100 ? cmd.slice(0, 100) + "..." : cmd,
        };

        if (!byDir.has(cwd)) byDir.set(cwd, []);
        byDir.get(cwd)!.push(entry);
      } catch {
        // skip
      }
    }
  } catch {
    // no claude processes
  }

  return byDir;
}

/** Find project directories with .claude configs across all configured scan roots */
async function findProjectDirs(): Promise<Set<string>> {
  const dirs = new Set<string>();

  for (const root of scanRoots()) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue; // root not accessible — skip it
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(root, entry.name);
      try {
        await stat(join(full, ".claude"));
        dirs.add(full);
      } catch {
        // no .claude dir
      }
    }
  }

  return dirs;
}

/** Find PRDs and match them to directories by keyword */
async function findPrdsForDir(dirName: string): Promise<Array<{
  slug: string;
  task: string;
  phase: string;
  progress: string;
  updated: string;
}>> {
  const keywords = dirName
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const results: Array<{
    slug: string;
    task: string;
    phase: string;
    progress: string;
    updated: string;
    score: number;
    mtime: number;
  }> = [];

  try {
    const dirs = await readdir(MEMORY_WORK);
    for (const slug of dirs) {
      try {
        const prdPath = join(MEMORY_WORK, slug, "PRD.md");
        const raw = await readFile(prdPath, "utf-8");
        const { data } = matter(raw);
        const task = ((data.task as string) ?? "").toLowerCase();
        const slugLower = slug.toLowerCase();

        const score = keywords.reduce((acc, kw) => {
          if (task.includes(kw)) return acc + 3;
          if (slugLower.includes(kw)) return acc + 2;
          return acc;
        }, 0);

        if (score > 0) {
          const stats = await stat(prdPath);
          results.push({
            slug,
            task: (data.task as string) ?? slug,
            phase: (data.phase as string) ?? "unknown",
            progress: (data.progress as string) ?? "0/0",
            updated: (data.updated as string) ?? "",
            score,
            mtime: stats.mtimeMs,
          });
        }
      } catch {
        // skip
      }
    }
  } catch {
    // no MEMORY/WORK dir
  }

  return results
    .sort((a, b) => b.score - a.score || b.mtime - a.mtime)
    .slice(0, 10)
    .map(({ score: _s, mtime: _m, ...rest }) => rest);
}

/** Get Claude session counts from JSONL logs */
async function getClaudeSessionData(dirBasename: string): Promise<{
  totalSessions: number;
  claudeProjectId: string;
  recentPreviews: Array<{ uuid: string; firstUserMessage: string; lastMessageAt: string }>;
}> {
  const PROJECTS_DIR = join(HOME, ".claude", "projects");

  try {
    const projDirs = await readdir(PROJECTS_DIR);
    // Find matching project dir by name similarity
    const searchTerms = dirBasename.toLowerCase().replace(/[_-]/g, "");

    for (const dir of projDirs) {
      const dirLower = dir.toLowerCase().replace(/-/g, "");
      if (dirLower.includes(searchTerms) || searchTerms.includes(dirLower.split("cloudocs")[1]?.replace(/\//g, "") ?? "___none___")) {
        // More robust: check if the directory basename appears at the end of the mangled path
        const mangledEnd = dir.toLowerCase().split("-").slice(-3).join("");
        const targetEnd = searchTerms.replace(/\s/g, "");
        if (mangledEnd.includes(targetEnd) || dirLower.endsWith(searchTerms)) {
          const fullDir = join(PROJECTS_DIR, dir);
          const entries = await readdir(fullDir, { withFileTypes: true });
          const jsonls = entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl"));

          // Get 3 most recent for previews (by mtime)
          const withMtimes = await Promise.all(
            jsonls.slice(0, 20).map(async (f) => {
              try {
                const s = await stat(join(fullDir, f.name));
                return { name: f.name, mtime: s.mtimeMs };
              } catch {
                return { name: f.name, mtime: 0 };
              }
            })
          );
          withMtimes.sort((a, b) => b.mtime - a.mtime);

          // Quick scan of the 3 most recent for preview
          const previews = [];
          for (const f of withMtimes.slice(0, 3)) {
            try {
              const raw = await readFile(join(fullDir, f.name), "utf-8");
              const lines = raw.trim().split("\n").slice(0, 20);
              let firstMsg = "";
              let lastTs = "";
              for (const line of lines) {
                try {
                  const d = JSON.parse(line);
                  if (d.timestamp) lastTs = d.timestamp;
                  if (d.type === "user" && !firstMsg) {
                    const content = d.message?.content ?? "";
                    const text = typeof content === "string" ? content : "";
                    firstMsg = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
                  }
                } catch { /* skip */ }
              }
              previews.push({
                uuid: basename(f.name, ".jsonl"),
                firstUserMessage: firstMsg,
                lastMessageAt: lastTs,
              });
            } catch { /* skip */ }
          }

          return {
            totalSessions: jsonls.length,
            claudeProjectId: dir,
            recentPreviews: previews,
          };
        }
      }
    }
  } catch {
    // no projects dir
  }

  return { totalSessions: 0, claudeProjectId: "", recentPreviews: [] };
}

/** Build the complete project list */
export async function scanProjects(): Promise<SkeinProject[]> {
  const activeByDir = scanActiveProcesses();
  const configDirs = await findProjectDirs();

  // Merge all known directories
  const allDirs = new Set<string>();
  for (const dir of activeByDir.keys()) allDirs.add(dir);
  for (const dir of configDirs) allDirs.add(dir);

  // Build project objects — all async work per dir runs in parallel
  const projects: SkeinProject[] = await Promise.all(
    Array.from(allDirs).map(async (dir) => {
      const activeSessions = activeByDir.get(dir) ?? [];
      const dirName = basename(dir);
      const [recentPrds, claudeData, enrichment] = await Promise.all([
        findPrdsForDir(dirName),
        getClaudeSessionData(dirName),
        enrichProject(dir),
      ]);

      let lastActivity = "";
      if (activeSessions.length > 0) {
        lastActivity = new Date().toISOString();
      } else if (claudeData.recentPreviews[0]?.lastMessageAt) {
        lastActivity = claudeData.recentPreviews[0].lastMessageAt;
      } else if (recentPrds.length > 0 && recentPrds[0].updated) {
        lastActivity = recentPrds[0].updated;
      }

      return {
        id: dirToId(dir),
        name: deriveProjectName(dir),
        directory: dir,
        relativeDir: dir.startsWith(HOME) ? "~" + dir.slice(HOME.length) : dir,
        activeSessions: activeSessions.length,
        activeSessionDetails: activeSessions,
        prdCount: recentPrds.length,
        recentPrds,
        totalClaudeSessions: claudeData.totalSessions,
        claudeProjectId: claudeData.claudeProjectId,
        recentSessionPreviews: claudeData.recentPreviews,
        lastActivity,
        hasClaudeConfig: configDirs.has(dir),
        enrichment,
      };
    })
  );

  // Sort: active first, then by total sessions (most used), then by last activity
  projects.sort((a, b) => {
    if (a.activeSessions > 0 && b.activeSessions === 0) return -1;
    if (b.activeSessions > 0 && a.activeSessions === 0) return 1;
    // Then by recency
    return (
      new Date(b.lastActivity || 0).getTime() -
      new Date(a.lastActivity || 0).getTime()
    );
  });

  return projects;
}
