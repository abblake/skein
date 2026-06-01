/**
 * Session Reader
 *
 * Reads Claude Code's actual conversation logs (~/.claude/projects/{project}/*.jsonl)
 * to provide real session data, not just PRD-tracked Algorithm sessions.
 *
 * Data source: 7,174 sessions across 48 projects (vs 74 PRDs).
 */

import { readdir, readFile, stat } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

export interface ClaudeSession {
  uuid: string;
  projectId: string;
  projectName: string;
  startedAt: string;
  lastMessageAt: string;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  sizeKb: number;
  firstUserMessage: string;   // First thing the user said — captures intent
  lastUserMessage: string;    // Last thing the user said — captures where they left off
  hasSubagents: boolean;
}

export interface ProjectSessionSummary {
  projectId: string;
  projectName: string;
  directory: string;
  totalSessions: number;
  totalSizeKb: number;
  recentSessions: ClaudeSession[];  // Last 10
}

/** Decode mangled project directory name to readable.
 *  Claude slugifies the absolute cwd by replacing every non-alphanumeric char
 *  with "-". We strip the current user's home prefix (derived from homedir(),
 *  so this works for any user — not a hardcoded username) and a macOS iCloud
 *  segment if present, then title-case the remainder. */
function decodeProjectName(mangledDir: string): string {
  const homeSlug = homedir().replace(/[^a-zA-Z0-9]/g, "-");
  const stripped = mangledDir
    .replace(new RegExp(`^${homeSlug}-Library-Mobile-Documents-com-apple-CloudDocs-`), "")
    .replace(new RegExp(`^${homeSlug}-`), "");
  return stripped
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Reconstruct the original directory path from the mangled name */
function decodeProjectPath(mangledDir: string): string {
  return "/" + mangledDir.replace(/^-/, "").replace(/-/g, "/");
}

/** Read a JSONL session file and extract key metadata — lightweight scan */
async function scanSession(
  filePath: string,
  projectId: string,
  projectName: string
): Promise<ClaudeSession | null> {
  try {
    const stats = await stat(filePath);
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);

    let firstUserMsg = "";
    let lastUserMsg = "";
    let firstTimestamp = "";
    let lastTimestamp = "";
    let userCount = 0;
    let assistantCount = 0;
    for (const line of lines) {
      try {
        const d = JSON.parse(line);
        const ts = d.timestamp ?? "";

        if (!firstTimestamp && ts) firstTimestamp = ts;
        if (ts) lastTimestamp = ts;

        if (d.type === "user") {
          userCount++;
          const content = d.message?.content ?? "";
          let text = "";
          if (typeof content === "string") {
            text = content;
          } else if (Array.isArray(content)) {
            text = content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text ?? "")
              .join(" ");
          }

          // Clean up system tags for display
          text = text
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 200);

          if (!firstUserMsg && text.length > 5) firstUserMsg = text;
          if (text.length > 5) lastUserMsg = text;
        }

        if (d.type === "assistant") assistantCount++;
      } catch {
        // skip bad lines
      }
    }

    const uuid = basename(filePath, ".jsonl");

    return {
      uuid,
      projectId,
      projectName,
      startedAt: firstTimestamp,
      lastMessageAt: lastTimestamp,
      messageCount: lines.length,
      userMessageCount: userCount,
      assistantMessageCount: assistantCount,
      sizeKb: Math.round(stats.size / 1024),
      firstUserMessage: firstUserMsg,
      lastUserMessage: lastUserMsg,
      hasSubagents: false, // We skip subagent dirs
    };
  } catch {
    return null;
  }
}

/** Get recent sessions for a project — reads only the N most recent JSONL files */
export async function getProjectSessions(
  mangledProjectDir: string,
  limit: number = 10
): Promise<ClaudeSession[]> {
  const projectDir = join(PROJECTS_DIR, mangledProjectDir);
  const projectId = mangledProjectDir;
  const projectName = decodeProjectName(mangledProjectDir);

  try {
    const entries = await readdir(projectDir, { withFileTypes: true });
    const jsonlFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => ({
        name: e.name,
        path: join(projectDir, e.name),
      }));

    // Get mtimes and sort by most recent
    const withMtimes = await Promise.all(
      jsonlFiles.map(async (f) => {
        try {
          const s = await stat(f.path);
          return { ...f, mtime: s.mtimeMs };
        } catch {
          return { ...f, mtime: 0 };
        }
      })
    );

    withMtimes.sort((a, b) => b.mtime - a.mtime);
    const recent = withMtimes.slice(0, limit);

    const sessions = await Promise.all(
      recent.map((f) => scanSession(f.path, projectId, projectName))
    );

    return sessions.filter((s): s is ClaudeSession => s !== null);
  } catch {
    return [];
  }
}

/** Get summaries for all projects — lightweight (counts + recent sessions only) */
export async function getAllProjectSummaries(): Promise<ProjectSessionSummary[]> {
  const summaries: ProjectSessionSummary[] = [];

  try {
    const projDirs = await readdir(PROJECTS_DIR, { withFileTypes: true });

    for (const dir of projDirs) {
      if (!dir.isDirectory()) continue;
      const projectId = dir.name;
      const projectName = decodeProjectName(projectId);
      const projectPath = decodeProjectPath(projectId);
      const fullDir = join(PROJECTS_DIR, dir.name);

      try {
        const entries = await readdir(fullDir, { withFileTypes: true });
        const jsonlFiles = entries.filter(
          (e) => e.isFile() && e.name.endsWith(".jsonl")
        );

        if (jsonlFiles.length === 0) continue;

        // Get total size
        let totalSize = 0;
        const fileMtimes: { name: string; mtime: number }[] = [];

        for (const f of jsonlFiles) {
          try {
            const s = await stat(join(fullDir, f.name));
            totalSize += s.size;
            fileMtimes.push({ name: f.name, mtime: s.mtimeMs });
          } catch {
            // skip
          }
        }

        // Get the 5 most recent sessions (lightweight scan)
        fileMtimes.sort((a, b) => b.mtime - a.mtime);
        const recentFiles = fileMtimes.slice(0, 5);
        const recentSessions = await Promise.all(
          recentFiles.map((f) =>
            scanSession(join(fullDir, f.name), projectId, projectName)
          )
        );

        summaries.push({
          projectId,
          projectName,
          directory: projectPath,
          totalSessions: jsonlFiles.length,
          totalSizeKb: Math.round(totalSize / 1024),
          recentSessions: recentSessions.filter(
            (s): s is ClaudeSession => s !== null
          ),
        });
      } catch {
        // skip unreadable dirs
      }
    }
  } catch {
    // no projects dir
  }

  // Sort by most recent activity
  summaries.sort((a, b) => {
    const aLatest = a.recentSessions[0]?.lastMessageAt ?? "";
    const bLatest = b.recentSessions[0]?.lastMessageAt ?? "";
    return (
      new Date(bLatest || 0).getTime() - new Date(aLatest || 0).getTime()
    );
  });

  return summaries;
}
