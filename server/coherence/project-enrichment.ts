/**
 * Project Enrichment
 *
 * Per-directory enrichment pulled from multiple sources:
 *   - Telos PROJECTS.md (matched via `**Working directory**:`)
 *   - project-links.json (/adhd-plan run count)
 *   - git (branch, dirty, last commit)
 *   - README.md (first paragraph preview)
 *   - filesystem stats (file count, last mtime)
 *
 * Every call is resilient — missing git/README/Telos/etc. returns null/0 rather
 * than throwing. Designed to run concurrently per project via Promise.all.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const execP = promisify(exec);

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const TELOS_PROJECTS = join(CLAUDE_DIR, "PAI/USER/TELOS/PROJECTS.md");
const PROJECT_LINKS = join(CLAUDE_DIR, "skein/project-links.json");

export interface TelosMatch {
  name: string;
  workingDir: string;
  block: string;
}

export interface GitInfo {
  branch: string;
  dirty: boolean;
  lastCommit: string;
  lastCommitDate: string;
}

export interface FsStats {
  fileCount: number;
  lastModified: string;
}

export interface Enrichment {
  telosProject: TelosMatch | null;
  adhdPlanCount: number;
  git: GitInfo | null;
  readmePreview: string;
  stats: FsStats | null;
}

/** Parse PROJECTS.md into {name, workingDir, block} entries. Cached per call-site. */
let telosCache: { mtime: number; entries: TelosMatch[] } | null = null;

async function loadTelos(): Promise<TelosMatch[]> {
  try {
    const s = await stat(TELOS_PROJECTS);
    if (telosCache && telosCache.mtime === s.mtimeMs) return telosCache.entries;

    const raw = await readFile(TELOS_PROJECTS, "utf-8");
    const lines = raw.split("\n");
    const entries: TelosMatch[] = [];
    let currentName: string | null = null;
    let currentStart = -1;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^## (.+)$/);
      if (m) {
        if (currentName !== null) {
          const block = lines.slice(currentStart, i).join("\n").trim();
          const wd = extractWorkingDir(block);
          entries.push({ name: currentName, workingDir: wd, block });
        }
        currentName = m[1].trim();
        currentStart = i;
      }
    }
    if (currentName !== null) {
      const block = lines.slice(currentStart).join("\n").trim();
      const wd = extractWorkingDir(block);
      entries.push({ name: currentName, workingDir: wd, block });
    }

    telosCache = { mtime: s.mtimeMs, entries };
    return entries;
  } catch {
    return [];
  }
}

function extractWorkingDir(block: string): string {
  const m = block.match(
    /^\s*-\s+\*\*Working directory\*\*:\s*`?([^`\n]+?)`?\s*$/m
  );
  if (!m) return "";
  return m[1].trim().replace(/^~(?=\/|$)/, HOME);
}

/** Normalize paths for comparison (resolve ~, trim trailing slash). */
function normPath(p: string): string {
  return p
    .replace(/^~(?=\/|$)/, HOME)
    .replace(/\/+$/, "")
    .toLowerCase();
}

async function matchTelos(dir: string): Promise<TelosMatch | null> {
  const telos = await loadTelos();
  const target = normPath(dir);
  for (const entry of telos) {
    if (!entry.workingDir) continue;
    if (normPath(entry.workingDir) === target) return entry;
  }
  // Prefix match as secondary — Telos sometimes lists a parent, project lives in subdir
  for (const entry of telos) {
    if (!entry.workingDir) continue;
    const wd = normPath(entry.workingDir);
    if (target.startsWith(wd + "/") || wd.startsWith(target + "/")) return entry;
  }
  return null;
}

let linksCache: { mtime: number; data: Record<string, { sessions: unknown[] }> } | null = null;

async function loadProjectLinks(): Promise<Record<string, { sessions: unknown[] }>> {
  try {
    const s = await stat(PROJECT_LINKS);
    if (linksCache && linksCache.mtime === s.mtimeMs) return linksCache.data;
    const raw = await readFile(PROJECT_LINKS, "utf-8");
    const data = JSON.parse(raw);
    linksCache = { mtime: s.mtimeMs, data };
    return data;
  } catch {
    return {};
  }
}

async function countAdhdPlans(telosMatch: TelosMatch | null): Promise<number> {
  if (!telosMatch) return 0;
  const links = await loadProjectLinks();
  const entry = links[telosMatch.name];
  if (!entry || !Array.isArray(entry.sessions)) return 0;
  return entry.sessions.length;
}

async function safeExec(cmd: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execP(cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 1500,
      maxBuffer: 256 * 1024,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function getGit(dir: string): Promise<GitInfo | null> {
  const inside = await safeExec("git rev-parse --is-inside-work-tree", dir);
  if (inside !== "true") return null;
  // Run the remaining three git queries concurrently
  const [branch, porcelain, lastCommit, lastCommitDate] = await Promise.all([
    safeExec("git rev-parse --abbrev-ref HEAD", dir),
    safeExec("git status --porcelain", dir),
    safeExec("git log -1 --pretty=format:%s", dir),
    safeExec("git log -1 --pretty=format:%cI", dir),
  ]);
  return { branch, dirty: porcelain.length > 0, lastCommit, lastCommitDate };
}

async function getReadmePreview(dir: string): Promise<string> {
  const candidates = ["README.md", "README.MD", "Readme.md", "readme.md"];
  for (const name of candidates) {
    try {
      const raw = await readFile(join(dir, name), "utf-8");
      const body = raw
        .replace(/^---[\s\S]*?---\s*/m, "") // strip frontmatter
        .replace(/^#+\s.*$/m, "") // strip leading heading
        .trim();
      const paragraph = body.split(/\n\s*\n/)[0]?.trim() ?? "";
      return paragraph.slice(0, 400);
    } catch {
      continue;
    }
  }
  return "";
}

async function getFsStats(dir: string): Promise<FsStats | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let fileCount = 0;
    let lastModified = 0;
    const toStat = entries.slice(0, 200); // bound the scan
    for (const e of toStat) {
      if (e.name.startsWith(".")) continue;
      if (e.isFile()) fileCount++;
      try {
        const s = await stat(join(dir, e.name));
        if (s.mtimeMs > lastModified) lastModified = s.mtimeMs;
      } catch {
        continue;
      }
    }
    return {
      fileCount,
      lastModified: lastModified > 0 ? new Date(lastModified).toISOString() : "",
    };
  } catch {
    return null;
  }
}

export async function enrichProject(dir: string): Promise<Enrichment> {
  const [telosProject, gitInfo, readmePreview, stats] = await Promise.all([
    matchTelos(dir),
    getGit(dir),
    getReadmePreview(dir),
    getFsStats(dir),
  ]);
  const adhdPlanCount = await countAdhdPlans(telosProject);
  return {
    telosProject,
    adhdPlanCount,
    git: gitInfo,
    readmePreview,
    stats,
  };
}
