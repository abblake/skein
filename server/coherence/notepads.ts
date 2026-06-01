/**
 * Session Notepads (#31 — in-directory vaults)
 *
 * Notes are written INTO the session's own working directory as a per-dir
 * Obsidian vault:
 *
 *   <cwd>/skein/notepad/<sessionId>.md   ← one note per session
 *   <cwd>/skein/.obsidian/               ← marker so the folder opens as a vault
 *   <cwd>/skein/.gitignore  ("*")        ← keeps the whole vault out of git status
 *
 * This is a deliberate exception to Skein's "write only to ~/.claude/skein/"
 * rule (recorded in CLAUDE.md / ISA). When a cwd is unknown or unwritable we
 * fall back to the legacy global pile at ~/.claude/skein/notepads/, which also
 * lets pre-#31 notes still load.
 */

import { readFile, writeFile, mkdir, readdir, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const GLOBAL_DIR = join(homedir(), ".claude", "skein", "notepads"); // legacy + fallback

/**
 * Invisible delimiter between the free-form scratchpad (above) and the
 * timestamped log (below). An HTML comment so Obsidian renders nothing for it.
 * Files without the marker are pure free-form (pre-log, backward compatible).
 */
const LOG_MARKER = "<!-- skein:log -->";

/** One committed log entry. `ts` is an ISO 8601 timestamp (server-stamped). */
export interface LogEntry {
  ts: string;
  body: string;
}

/** Stable filesystem-safe filename for a note key (sessionId, or dir+tty fallback). */
export function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export interface Notepad {
  key: string;
  /** The free-form scratchpad portion only (above the log marker). */
  content: string;
  /** Timestamped log entries, oldest first. */
  entries: LogEntry[];
  updatedAt: string | null;
  location: string;
  vault?: string;
  legacy?: boolean;
}

/**
 * Per-path async mutex. Free-form auto-save and log-append both rewrite the
 * whole file via read-modify-write; without serialization their awaits can
 * interleave and clobber each other. Chaining on the path guarantees order.
 */
const fileLocks = new Map<string, Promise<unknown>>();
function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(path) ?? Promise.resolve();
  const run = prev.then(fn, fn); // run regardless of the previous op's outcome
  fileLocks.set(
    path,
    run.catch(() => {})
  );
  return run;
}

/** Split a raw note file into its free-form head and parsed log entries. */
export function parseNotepadFile(raw: string): { freeform: string; entries: LogEntry[] } {
  const idx = raw.indexOf(LOG_MARKER);
  if (idx === -1) return { freeform: raw, entries: [] };

  const freeform = raw.slice(0, idx).replace(/\s+$/, "");
  const logPart = raw.slice(idx + LOG_MARKER.length);
  const entries: LogEntry[] = [];
  // Each entry starts at a "### " heading on its own line; the timestamp is the
  // entire heading line, the body is everything up to the next heading.
  for (const block of logPart.split(/\n(?=### )/)) {
    const nl = block.indexOf("\n");
    const head = (nl === -1 ? block : block.slice(0, nl)).match(/^###\s+(.+?)\s*$/);
    if (!head) continue;
    const ts = head[1].trim();
    if (Number.isNaN(Date.parse(ts))) continue; // tolerant: skip non-date headings
    entries.push({ ts, body: nl === -1 ? "" : block.slice(nl + 1).trim() });
  }
  entries.sort((a, b) => a.ts.localeCompare(b.ts));
  return { freeform, entries };
}

/** Reassemble a note file from its free-form head and log entries. */
export function serializeNotepadFile(freeform: string, entries: LogEntry[]): string {
  if (entries.length === 0) return freeform; // no marker until there's a log
  const head = freeform.replace(/\s+$/, "");
  const log = entries.map((e) => `### ${e.ts}\n${e.body.trim()}`).join("\n\n");
  return `${head}\n\n${LOG_MARKER}\n\n${log}\n`;
}

/** Core plugins enabled in a fresh notes vault — the note-centric set. */
const DEFAULT_CORE_PLUGINS: Record<string, boolean> = {
  "file-explorer": true,
  "global-search": true,
  switcher: true,
  graph: true,
  backlink: true,
  "outgoing-link": true,
  "tag-pane": true,
  "page-preview": true,
  outline: true,
  "word-count": true,
  "command-palette": true,
};

/** <cwd>/skein — the per-directory vault root. */
function vaultRoot(dir: string): string {
  return join(dir, "skein");
}

/** <cwd>/skein/notepad — where the per-session .md files live. */
function notesDir(dir: string): string {
  return join(vaultRoot(dir), "notepad");
}

async function writeIfAbsent(path: string, contents: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    await writeFile(path, contents, "utf-8");
  }
}

/**
 * Ensure the per-dir Obsidian vault FOLDER exists (idempotent).
 * Scaffolds: notepad/ dir, .obsidian/ config (app/appearance/core-plugins),
 * .gitignore. Does NOT register the vault in Obsidian's switcher — that is
 * deliberately deferred to the first save (see registerVault) so the switcher
 * isn't flooded with empty vaults for every project you happen to open.
 *
 * Called by the heartbeat scanner for every live cwd, and by saveNotepad.
 */
export async function ensureVault(dir: string): Promise<void> {
  const vault = vaultRoot(dir);
  await mkdir(notesDir(dir), { recursive: true });

  const ob = join(vault, ".obsidian");
  await mkdir(ob, { recursive: true });
  await writeIfAbsent(join(ob, "app.json"), "{}\n");
  await writeIfAbsent(join(ob, "appearance.json"), "{}\n");
  await writeIfAbsent(
    join(ob, "core-plugins.json"),
    JSON.stringify(DEFAULT_CORE_PLUGINS, null, 2) + "\n"
  );

  // "*" makes the whole skein/ vault invisible to git (incl. this file itself),
  // so notes never show up in `git status` regardless of repo/worktree layout.
  await writeIfAbsent(
    join(vault, ".gitignore"),
    "# Skein session notes — local only, not version-controlled\n*\n"
  );
}

/** Register the vault in Obsidian's switcher — non-fatal, must never block a save. */
async function registerVault(dir: string): Promise<void> {
  try {
    const { registerObsidianVault } = await import("./obsidian-vault");
    await registerObsidianVault(vaultRoot(dir));
  } catch {
    // Obsidian not installed / config locked — note still saves fine.
  }
}

/**
 * Prepare a vault to be opened in Obsidian RIGHT NOW: ensure the folder exists,
 * (re-)register it in Obsidian's switcher so the URI can resolve it (Obsidian
 * only opens vaults present in obsidian.json), and make sure the note file
 * exists so `&file=` lands on a real note. Returns the bits the URI needs.
 */
export async function prepareVaultForOpen(
  dir: string,
  key: string
): Promise<{ vault: string; vaultId: string; rel: string; location: string }> {
  const safe = sanitizeKey(key);
  await ensureVault(dir);

  const file = join(notesDir(dir), `${safe}.md`);
  await writeIfAbsent(file, ""); // so the note opens even if never saved

  const { registerObsidianVault } = await import("./obsidian-vault");
  const { id } = await registerObsidianVault(vaultRoot(dir));

  return {
    vault: vaultRoot(dir),
    vaultId: id,
    rel: join("notepad", `${safe}.md`),
    location: file,
  };
}

/** Read a session's notepad. dir=null => global fallback. Falls back to legacy global file. */
export async function loadNotepad(dir: string | null, key: string): Promise<Notepad> {
  const safe = sanitizeKey(key);

  if (dir) {
    const primary = join(notesDir(dir), `${safe}.md`);
    try {
      const raw = await readFile(primary, "utf-8");
      const s = await stat(primary);
      const { freeform, entries } = parseNotepadFile(raw);
      return {
        key: safe,
        content: freeform,
        entries,
        updatedAt: s.mtime.toISOString(),
        location: primary,
        vault: vaultRoot(dir),
      };
    } catch {
      // fall through to legacy global lookup so pre-#31 notes still appear
    }
  }

  const legacy = join(GLOBAL_DIR, `${safe}.md`);
  try {
    const raw = await readFile(legacy, "utf-8");
    const s = await stat(legacy);
    const { freeform, entries } = parseNotepadFile(raw);
    return {
      key: safe,
      content: freeform,
      entries,
      updatedAt: s.mtime.toISOString(),
      location: legacy,
      legacy: dir ? true : undefined,
    };
  } catch {
    return {
      key: safe,
      content: "",
      entries: [],
      updatedAt: null,
      location: dir ? join(notesDir(dir), `${safe}.md`) : legacy,
      vault: dir ? vaultRoot(dir) : undefined,
    };
  }
}

/** Resolve where a note writes: the cwd vault if possible, else the global pile. */
async function resolveNoteTarget(
  dir: string | null,
  safe: string
): Promise<{ target: string; savedToDir: boolean }> {
  if (dir) {
    try {
      await ensureVault(dir);
      return { target: join(notesDir(dir), `${safe}.md`), savedToDir: true };
    } catch {
      // vault unwritable — fall back to the global pile below
    }
  }
  await mkdir(GLOBAL_DIR, { recursive: true });
  return { target: join(GLOBAL_DIR, `${safe}.md`), savedToDir: false };
}

/**
 * Save the FREE-FORM portion of a session's notepad, preserving any existing
 * log entries. Writes into the cwd vault; falls back to global if unwritable.
 */
export async function saveNotepad(dir: string | null, key: string, content: string): Promise<Notepad> {
  const safe = sanitizeKey(key);
  const { target, savedToDir } = await resolveNoteTarget(dir, safe);

  return withFileLock(target, async () => {
    let raw = "";
    try {
      raw = await readFile(target, "utf-8");
    } catch {
      // new note — no existing entries to preserve
    }
    const { entries } = parseNotepadFile(raw);
    await writeFile(target, serializeNotepadFile(content, entries), "utf-8");

    if (savedToDir && dir) await registerVault(dir);
    const s = await stat(target);
    return {
      key: safe,
      content,
      entries,
      updatedAt: s.mtime.toISOString(),
      location: target,
      vault: dir ? vaultRoot(dir) : undefined,
    };
  });
}

/**
 * Append one server-timestamped entry to a session's log, preserving the
 * free-form portion. Returns the full notepad (free-form + all entries).
 */
export async function appendLogEntry(dir: string | null, key: string, body: string): Promise<Notepad> {
  const safe = sanitizeKey(key);
  const { target, savedToDir } = await resolveNoteTarget(dir, safe);

  return withFileLock(target, async () => {
    let raw = "";
    try {
      raw = await readFile(target, "utf-8");
    } catch {
      // new note
    }
    const { freeform, entries } = parseNotepadFile(raw);
    entries.push({ ts: new Date().toISOString(), body: body.trim() });
    await writeFile(target, serializeNotepadFile(freeform, entries), "utf-8");

    if (savedToDir && dir) await registerVault(dir);
    const s = await stat(target);
    return {
      key: safe,
      content: freeform,
      entries,
      updatedAt: s.mtime.toISOString(),
      location: target,
      vault: dir ? vaultRoot(dir) : undefined,
    };
  });
}

/** Keys (sanitized) that already have a non-empty note in a given cwd vault. */
export async function listNotepadKeysForDir(dir: string): Promise<Record<string, { updatedAt: string }>> {
  const out: Record<string, { updatedAt: string }> = {};
  try {
    const folder = notesDir(dir);
    const files = await readdir(folder);
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const s = await stat(join(folder, f));
      if (s.size > 0) out[f.replace(/\.md$/, "")] = { updatedAt: s.mtime.toISOString() };
    }
  } catch {
    // no vault yet
  }
  return out;
}
