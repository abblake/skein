/**
 * Rhythm detection — ⑤ of the Hermes/PAI roadmap.
 *
 * Flags projects you RETURN to repeatedly (active on many distinct days), so the
 * board can suggest scheduling them — Hermes' "tasks you do repeatedly → automate."
 * We only DETECT + SUGGEST here; creating a cron is high-impact and stays manual
 * (the user runs /schedule). Recompute is cached hourly (stat-ing session files
 * every 10s scan would be wasteful).
 *
 * Two signals: session-file activity across distinct days (works immediately) and
 * a resume-log of opens (the truer "I keep coming back" signal, accrues over time).
 */

import { readdir, stat, appendFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const HOME = homedir();
const PROJECTS_DIR = join(HOME, ".claude", "projects");
const SKEIN_DIR = join(HOME, ".claude", "skein");
const RESUME_LOG = join(SKEIN_DIR, "resume-log.jsonl");

const WINDOW_DAYS = 21;
const MIN_DISTINCT_DAYS = 5; // active on ≥5 distinct days → a rhythm
const CACHE_TTL_MS = 60 * 60 * 1000;

let cache: { at: number; set: Set<string> } = { at: 0, set: new Set() };

/** Distinct calendar days a project's sessions were touched within the window. */
async function distinctActiveDays(slug: string, cutoffMs: number): Promise<number> {
  let files: string[];
  try {
    files = (await readdir(join(PROJECTS_DIR, slug))).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return 0;
  }
  const days = new Set<string>();
  for (const f of files) {
    try {
      const m = (await stat(join(PROJECTS_DIR, slug, f))).mtimeMs;
      if (m >= cutoffMs) days.add(new Date(m).toISOString().slice(0, 10));
    } catch { /* skip */ }
  }
  return days.size;
}

/**
 * Set of projectIds that qualify as rhythms. Cached hourly. Pass the projectIds
 * currently on the board so we only scan relevant folders.
 */
export async function getRecurring(projectIds: string[]): Promise<Set<string>> {
  if (Date.now() - cache.at < CACHE_TTL_MS && cache.set.size >= 0 && cache.at !== 0) {
    return cache.set;
  }
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const set = new Set<string>();
  for (const slug of new Set(projectIds)) {
    if ((await distinctActiveDays(slug, cutoff)) >= MIN_DISTINCT_DAYS) set.add(slug);
  }
  cache = { at: Date.now(), set };
  return set;
}

/** Append an open/resume event — the long-term "keep coming back" signal. */
export async function logOpen(projectId: string, uuid: string, action: string): Promise<void> {
  try {
    await mkdir(SKEIN_DIR, { recursive: true });
    await appendFile(RESUME_LOG, JSON.stringify({ projectId, uuid, action, ts: new Date().toISOString() }) + "\n");
  } catch { /* non-fatal */ }
}

/** How many times a project was opened in the last `days` (from the resume log). */
export async function openCount(projectId: string, days = WINDOW_DAYS): Promise<number> {
  try {
    const cutoff = Date.now() - days * 86_400_000;
    const raw = await readFile(RESUME_LOG, "utf-8");
    return raw.split("\n").filter(Boolean).reduce((n, line) => {
      try {
        const e = JSON.parse(line);
        return e.projectId === projectId && new Date(e.ts).getTime() >= cutoff ? n + 1 : n;
      } catch { return n; }
    }, 0);
  } catch {
    return 0;
  }
}

// Test: `bun server/coherence/rhythm.ts <slug...>`
if (import.meta.main) {
  getRecurring(process.argv.slice(2)).then((s) => console.log("rhythms:", [...s]));
}
