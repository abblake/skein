/**
 * Goal-Link — ③ of the Hermes/PAI roadmap (Plans/parking-lot.md).
 *
 * Infers which TELOS life-goal each project advances, so the parking lot is a
 * Life-OS surface (Hermes' "deepening model of who you are"), not just a window
 * manager. Inferred ONCE per project (cached in ~/.claude/skein/project-goals.json),
 * since all windows in a project share a goal — keeps LLM calls minimal.
 */

import { execFile } from "child_process";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const HOME = homedir();
const GOALS_FILE = join(HOME, ".claude", "PAI", "USER", "TELOS", "GOALS.md");
const CACHE_FILE = join(HOME, ".claude", "skein", "project-goals.json");
const INFERENCE = join(HOME, ".claude", "PAI", "TOOLS", "Inference.ts");

export interface Goal { id: string; title: string; }
export interface GoalLink { id: string; label: string; }
type Cache = Record<string, GoalLink>; // projectId -> goal

const inFlight = new Set<string>();

/** Parse active TELOS goals (`- **G7:** title`) from GOALS.md. */
export async function loadGoals(): Promise<Goal[]> {
  let raw: string;
  try {
    raw = await readFile(GOALS_FILE, "utf-8");
  } catch {
    return [];
  }
  const goals: Goal[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^- \*\*(G\d+):\*\*\s*(.+)$/);
    if (m) goals.push({ id: m[1], title: m[2].trim() });
  }
  return goals;
}

async function loadCache(): Promise<Cache> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

/** Read the cached goal for a project. */
export async function projectGoal(projectId: string): Promise<GoalLink | undefined> {
  return (await loadCache())[projectId];
}

/** Whole project→goal cache, loaded once per capture scan. */
export async function loadGoalCache(): Promise<Cache> {
  return loadCache();
}

function runInference(sys: string, user: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "bun",
      [INFERENCE, "--level", "fast", "--timeout", "45000", sys, user],
      { timeout: 55000 },
      (err, stdout) => resolve(err ? "" : stdout.trim()),
    );
  });
}

/**
 * Ensure a project has an inferred goal link. Fire-and-forget; caches the result.
 * `hint` is the thread title and/or digest — the signal for what the work is.
 */
export function ensureProjectGoal(projectId: string, projectName: string, hint: string): void {
  if (inFlight.has(projectId)) return;
  inFlight.add(projectId);
  (async () => {
    try {
      const cache = await loadCache();
      if (cache[projectId]) return; // already linked
      const goals = await loadGoals();
      if (goals.length === 0) return;

      const sys =
        "Map a work project to the single TELOS life-goal it most advances. " +
        "The PROJECT FOLDER NAME is your strongest signal; recent activity is secondary context. " +
        "Pick the most plausible goal. Answer NONE only for clearly personal/non-goal work (travel, hobbies, learning experiments). " +
        "Reply with ONLY the goal id (e.g. G7) or NONE. No other text.";
      const user =
        `GOALS:\n${goals.map((g) => `${g.id}: ${g.title}`).join("\n")}\n\n` +
        `PROJECT FOLDER: ${projectName}\nRECENT ACTIVITY: ${hint || "(none)"}\n\nGoal id:`;

      const out = await runInference(sys, user);
      const id = out.match(/G\d+/)?.[0];
      const goal = goals.find((g) => g.id === id);
      // Cache the decision either way (NONE → empty label) so we don't re-infer.
      const fresh = await loadCache();
      fresh[projectId] = goal ? { id: goal.id, label: goal.title } : { id: "", label: "" };
      await mkdir(join(HOME, ".claude", "skein"), { recursive: true });
      await writeFile(CACHE_FILE, JSON.stringify(fresh, null, 2), "utf-8");
    } catch {
      /* next scan retries */
    } finally {
      inFlight.delete(projectId);
    }
  })();
}

// Test: `bun server/coherence/goal-link.ts <projectName> <hint>`
if (import.meta.main) {
  const [name, ...hint] = process.argv.slice(2);
  loadGoals().then(async (goals) => {
    const sys =
      "You map a work project to the single TELOS life-goal it most advances. " +
      "Reply with ONLY the goal id (e.g. G7) or NONE. No other text.";
    const user = `GOALS:\n${goals.map((g) => `${g.id}: ${g.title}`).join("\n")}\n\nPROJECT: ${name}\nWHAT IT'S ABOUT: ${hint.join(" ")}\n\nGoal id:`;
    console.log("goals parsed:", goals.length);
    console.log("inferred:", await runInference(sys, user));
  });
}
