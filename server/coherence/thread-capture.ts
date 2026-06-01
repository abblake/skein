/**
 * Thread Capture — P1 spine of the Parking Lot (see Plans/parking-lot.md)
 *
 * Turns live Claude Code sessions into persistent ThreadCards in
 * ~/.claude/skein/threads.json. A card is keyed on the session UUID, which is
 * also the resume id, the session-names.json key, and the .jsonl filename.
 *
 * VERIFIED on this machine (2026-05-20):
 * - cwd must be read space-safe via `lsof -Fn` — `awk '{print $NF}'` truncates
 *   iCloud paths because "Mobile Documents" contains a space.
 * - Claude's project-folder slug = the absolute cwd with every non-alphanumeric
 *   char replaced by "-". e.g. /Users/you/.../skein -> -Users-you-...-skein
 * - A live process does NOT hold its .jsonl open, so the resume UUID is the
 *   NEWEST .jsonl in that folder (the actively-appended one).
 */

import { execSync } from "child_process";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { ensureDigest } from "./digest";
import { ensureProjectGoal, loadGoalCache } from "./goal-link";
import { getRecurring } from "./rhythm";

const HOME = homedir();
const SKEIN_DIR = join(HOME, ".claude", "skein");
const THREADS_FILE = join(SKEIN_DIR, "threads.json");
const PROJECTS_DIR = join(HOME, ".claude", "projects");
const SESSION_NAMES = join(HOME, ".claude", "MEMORY", "STATE", "session-names.json");
const WORK_JSON = join(HOME, ".claude", "MEMORY", "STATE", "work.json");

const STALE_DAYS = 14;

export type Column = "live" | "parked" | "waiting" | "done";

export interface ThreadCard {
  id: string;          // STABLE thread identity (not the rotating session uuid)
                       //   live   = `${projectId}__${ttySafe}` (one per window)
                       //   parked = `${projectId}__parked`     (one per project)
  uuid: string;        // current resume target: newest session in the project
  title: string;
  projectId: string;   // slugified cwd (the projects/ folder name)
  projectDir: string;  // absolute cwd
  column: Column;
  filed: boolean;      // true once manually placed in waiting/done
  live: boolean;       // process running right now (the ever-present dot)
  status?: string;     // live activity from registry: busy | idle | waiting | shell
  pid?: number;
  tty?: string;        // joins to a Terminal window for focus
  lastActiveAt: string;
  stale: boolean;
  firstSeenAt: string;
  digest?: string;     // LLM summary of what the thread did (generated on park)
  digestAt?: string;
  goalId?: string;     // TELOS goal this project advances (e.g. G7), inferred once
  goalLabel?: string;
  recurring?: boolean; // project you return to often — a candidate to schedule
}

export interface ThreadStore {
  lastScan: string;
  cards: ThreadCard[];
}

/** Replace every non-alphanumeric char with "-" — Claude's exact folder rule. */
function slugifyCwd(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

const SESSIONS_DIR = join(HOME, ".claude", "sessions");

interface LiveProc {
  pid: number;
  tty: string;
  cwd: string;       // from the registry — full, untruncated
  sessionId: string; // the window's CURRENT session, authoritative
  status: string;    // busy | idle | shell | waiting
  updatedAt: number; // registry's real last-activity time (epoch ms), for recency
}

/** Is this pid currently alive? (registry files can be stale.) */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Live interactive windows, from Claude Code's own session registry
 * (~/.claude/sessions/<pid>.json). This is the deterministic source of truth:
 * each file maps a pid to its CURRENT sessionId + cwd + kind + status — so two
 * windows in the same directory resolve to their own distinct sessions.
 */
function scanLiveProcs(): LiveProc[] {
  const procs: LiveProc[] = [];
  let files: string[];
  try {
    files = require("fs").readdirSync(SESSIONS_DIR).filter((f: string) => f.endsWith(".json"));
  } catch {
    return procs;
  }

  for (const file of files) {
    try {
      const reg = JSON.parse(require("fs").readFileSync(join(SESSIONS_DIR, file), "utf-8"));
      const pid = reg.pid;
      // Only live, interactive windows with a known session + cwd.
      if (!pid || !pidAlive(pid)) continue;
      if (reg.kind !== "interactive") continue;
      if (!reg.sessionId || !reg.cwd) continue;

      // tty (for window focus) still comes from ps; skip if no real tty.
      const tty = execSync(`ps -p ${pid} -o tty= 2>/dev/null`, { encoding: "utf-8" }).trim();
      if (!/^ttys[0-9]+$/.test(tty)) continue;

      procs.push({
        pid,
        tty: `/dev/${tty}`,
        cwd: reg.cwd,
        sessionId: reg.sessionId,
        status: reg.status ?? "",
        updatedAt: typeof reg.updatedAt === "number" ? reg.updatedAt : 0,
      });
    } catch {
      // unreadable/partial registry file
    }
  }
  return procs;
}

async function loadJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

/** uuid -> task, from work.json (keyed off sessionUUID inside each session). */
async function buildWorkTaskMap(): Promise<Record<string, string>> {
  const work = await loadJson<{ sessions?: Record<string, any> }>(WORK_JSON, {});
  const map: Record<string, string> = {};
  for (const s of Object.values(work.sessions ?? {})) {
    if (s?.sessionUUID && s?.task) map[s.sessionUUID] = String(s.task);
  }
  return map;
}

// Injected/meta content that is never a real prompt — skip these user messages.
const NOISE_PREFIXES = [
  "This session is being continued",
  "PREVIOUS AI RESPONSE",
  "Caveat:",
  "<system-reminder",
  "<local-command",
];

/** Clean a raw user-message string into a candidate title, or "" if it's noise. */
function cleanPrompt(raw: string): string {
  let t = raw;
  // Slash commands wrap the real prompt in <command-args>…</command-args>.
  const args = t.match(/<command-args>([\s\S]*?)<\/command-args>/);
  if (args) t = args[1];
  // /think and friends restate the prompt after a **Problem:** marker.
  const problem = t.match(/\*\*Problem:\*\*\s*([\s\S]*?)(?:\n\n|---|$)/);
  if (problem && problem[1].trim()) t = problem[1];
  // Strip any leftover command wrapper tags.
  t = t.replace(/<command-[a-z]+>[\s\S]*?<\/command-[a-z]+>/g, "");
  t = t.replace(/^#\s*\/\w+/, ""); // leading "# /think" header
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (NOISE_PREFIXES.some((p) => t.startsWith(p))) return "";
  return t.slice(0, 70);
}

/** Deep-fallback title: first *real* user prompt from the session .jsonl. */
async function firstUserMessage(slug: string, uuid: string): Promise<string | null> {
  try {
    const raw = await readFile(join(PROJECTS_DIR, slug, `${uuid}.jsonl`), "utf-8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let obj: any;
      try { obj = JSON.parse(line); } catch { continue; }
      const role = obj?.message?.role ?? obj?.role;
      if (role !== "user") continue;
      const content = obj?.message?.content ?? obj?.content;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.find((c: any) => typeof c?.text === "string")?.text
          : null;
      if (!text) continue;
      const cleaned = cleanPrompt(String(text));
      if (cleaned) return cleaned; // first message that survives the noise filter
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveTitle(
  uuid: string,
  names: Record<string, string>,
  tasks: Record<string, string>,
  jsonlMsg: string | null,
  slug: string
): string {
  return (
    names[uuid] ||
    (tasks[uuid] ? tasks[uuid].replace(/\s+/g, " ").slice(0, 80) : "") ||
    jsonlMsg ||
    slug.split("-").slice(-2).join("-") ||
    uuid.slice(0, 8)
  );
}

/** Capture pass: reconcile live windows with the persisted store and write it.
 *
 * Identity is the WINDOW, via Claude Code's session registry (one pid = one
 * window = one card). Each live window reports its OWN current sessionId, so
 * two windows in the same directory get distinct cards. When a window closes,
 * its card is parked retaining that final session — no phantoms, no collapse.
 */
export async function captureThreads(): Promise<ThreadStore> {
  const prev = await loadJson<ThreadStore>(THREADS_FILE, { lastScan: "", cards: [] });
  const prevById = new Map(prev.cards.map((c) => [c.id, c]));

  const names = await loadJson<Record<string, string>>(SESSION_NAMES, {});
  const tasks = await buildWorkTaskMap();
  const goalCache = await loadGoalCache();

  const now = new Date();
  const nowIso = now.toISOString();
  const live = scanLiveProcs();

  const cards: ThreadCard[] = [];
  const liveSessionIds = new Set<string>(); // sessions currently live (any window)
  const goalFired = new Set<string>();       // projects we've kicked goal-inference for this scan

  // Helper: resolve a display title for a session, preferring a prior card's.
  async function titleFor(prevTitle: string | undefined, slug: string, uuid: string) {
    if (prevTitle) return prevTitle;
    const jsonlMsg = await firstUserMessage(slug, uuid);
    return resolveTitle(uuid, names, tasks, jsonlMsg, slug);
  }

  // Digest every card. Parked sessions are frozen (generate once); live threads
  // evolve, so re-digest when stale (>10 min) AND the session advanced since.
  const DIGEST_REFRESH_MS = 10 * 60 * 1000;
  function maybeDigest(card: ThreadCard) {
    const ref = { id: card.id, uuid: card.uuid, projectId: card.projectId };
    if (!card.digest) { ensureDigest(ref); return; }
    if (card.live && card.digestAt) {
      const stale = now.getTime() - new Date(card.digestAt).getTime() > DIGEST_REFRESH_MS;
      const advanced = new Date(card.lastActiveAt).getTime() > new Date(card.digestAt).getTime();
      if (stale && advanced) ensureDigest(ref);
    }
  }

  // Stamp a card with its project's cached goal; infer once per uncached project.
  function linkGoal(card: ThreadCard) {
    const g = goalCache[card.projectId];
    if (g) {
      card.goalId = g.id || undefined;
      card.goalLabel = g.label || undefined;
    } else if (!goalFired.has(card.projectId)) {
      goalFired.add(card.projectId);
      const name = card.projectDir.split("/").pop() ?? card.projectId;
      ensureProjectGoal(card.projectId, name, `${card.title} ${card.digest ?? ""}`.trim());
    }
  }

  // 1) Live windows: one card per window, keyed by its current session.
  for (const proc of live) {
    const slug = slugifyCwd(proc.cwd);
    const id = `win-${proc.sessionId}`;
    liveSessionIds.add(proc.sessionId);
    const prevCard = prevById.get(id);
    const card: ThreadCard = {
      id,
      uuid: proc.sessionId, // authoritative resume target for THIS window
      title: await titleFor(prevCard?.title, slug, proc.sessionId),
      projectId: slug,
      projectDir: proc.cwd,
      column: prevCard?.filed ? prevCard.column : "live",
      filed: prevCard?.filed ?? false,
      live: true,
      status: proc.status || "idle",
      pid: proc.pid,
      tty: proc.tty,
      // real last-activity from the registry, so recent windows sort to the top
      lastActiveAt: proc.updatedAt ? new Date(proc.updatedAt).toISOString() : nowIso,
      stale: false,
      firstSeenAt: prevCard?.firstSeenAt ?? nowIso,
      digest: prevCard?.digest,
      digestAt: prevCard?.digestAt,
    };
    linkGoal(card);
    maybeDigest(card);
    cards.push(card);
  }

  // 2) Park previously-seen cards whose window is gone — retain their session.
  //    One window → one parked card (its final session). Dedup by session.
  const parkedSessions = new Set<string>();
  for (const card of prev.cards) {
    if (liveSessionIds.has(card.uuid)) continue; // still live elsewhere
    if (parkedSessions.has(card.uuid)) continue; // already parked this session
    parkedSessions.add(card.uuid);

    const ageMs = now.getTime() - new Date(card.lastActiveAt).getTime();
    const wentStale = ageMs > STALE_DAYS * 86_400_000;
    const parked = {
      ...card,
      id: card.id.startsWith("win-") ? `parked-${card.uuid}` : card.id,
      live: false,
      pid: undefined,
      tty: undefined,
      status: undefined,
      column: card.filed ? card.column : "parked",
      stale: card.filed ? card.stale : wentStale,
    };
    linkGoal(parked);
    maybeDigest(parked);
    cards.push(parked);
  }

  // Flag rhythms — projects returned to on many distinct days (cached hourly).
  const recurring = await getRecurring(cards.map((c) => c.projectId));
  for (const c of cards) c.recurring = recurring.has(c.projectId) || undefined;

  const store: ThreadStore = { lastScan: nowIso, cards };
  await mkdir(SKEIN_DIR, { recursive: true });
  await writeFile(THREADS_FILE, JSON.stringify(store, null, 2), "utf-8");
  return store;
}

/**
 * Manually place a card in a column (the drag action). Dropping into
 * waiting/done FILES the card (sticky — capture won't override it). Dropping
 * back into live/parked UNFILES it (auto live/parked detection takes over).
 * Persists to threads.json; the next capture preserves filed cards.
 */
export async function setThreadColumn(id: string, column: Column): Promise<ThreadCard | null> {
  const store = await loadJson<ThreadStore>(THREADS_FILE, { lastScan: "", cards: [] });
  const card = store.cards.find((c) => c.id === id);
  if (!card) return null;

  const filing = column === "waiting" || column === "done";
  card.filed = filing;
  card.column = filing ? column : card.live ? "live" : "parked";
  store.cards = store.cards.map((c) => (c.id === id ? card : c));

  await mkdir(SKEIN_DIR, { recursive: true });
  await writeFile(THREADS_FILE, JSON.stringify(store, null, 2), "utf-8");
  return card;
}

// Run directly: `bun server/coherence/thread-capture.ts`
if (import.meta.main) {
  captureThreads().then((store) => {
    console.log(`Captured ${store.cards.length} cards @ ${store.lastScan}\n`);
    for (const c of store.cards) {
      const dot = c.live ? "🟢" : "⚪";
      console.log(`${dot} [${c.column.padEnd(7)}] ${c.title}`);
      console.log(`     id=${c.id}  resume=${c.uuid.slice(0, 8)}`);
    }
  });
}
