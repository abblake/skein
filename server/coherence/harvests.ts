/**
 * Harvest Viewer — the read side of the harvest loop.
 *
 * The harvest GENERATOR (server/coherence/harvest.ts) distills a thread into a
 * skill doc and writes it to Skein-owned ~/.claude/skein/harvests/. This module
 * closes the loop: list those docs and read one for the in-Skein Harvests view.
 *
 * READ-ONLY over Skein-owned files. We never write here (generation owns the
 * write path) and NEVER touch any PAI-owned path. Promotion to a real PAI skill
 * is surface-only (see /api/harvest/reveal + the UI copy-path/prompt buttons).
 */

import { readFile, readdir, stat } from "fs/promises";
import { join, resolve, sep } from "path";
import { homedir } from "os";

/** Single source of truth for the harvests dir — must match harvest.ts. */
export const HARVEST_DIR = join(homedir(), ".claude", "skein", "harvests");

export interface HarvestSummary {
  /** Filename within HARVEST_DIR, e.g. "2026-05-21-win-0617215e-….md". */
  file: string;
  /** Title from the `# Harvest: <title>` heading (falls back to the filename). */
  title: string;
  /** Source thread uuid from the `> From thread <uuid> · …` line, if present. */
  uuid: string | null;
  /** YYYY-MM-DD parsed from the filename prefix, if present. */
  date: string | null;
  /** File mtime (ms) — the sort axis (newest first). */
  mtime: number;
  /** File size in bytes. */
  size: number;
  /** First non-heading prose line, for a one-line list preview. */
  preview: string;
}

export interface HarvestDoc {
  file: string;
  title: string;
  uuid: string | null;
  date: string | null;
  /** The full raw markdown of the harvest doc. */
  raw: string;
  /** Absolute path, for the copy-path / promote affordances. */
  location: string;
}

const FILENAME_DATE = /^(\d{4}-\d{2}-\d{2})-/;
const TITLE_RE = /^#\s+Harvest:\s*(.+?)\s*$/;
const FROM_RE = /^>\s*From thread\s+([0-9a-fA-F-]+)\s*·/;

/** Pull title, uuid, and first prose line out of a harvest doc's raw markdown. */
function parseHeader(raw: string, file: string): {
  title: string;
  uuid: string | null;
  preview: string;
} {
  const lines = raw.split("\n");
  let title = "";
  let uuid: string | null = null;
  let preview = "";

  for (const line of lines) {
    const t = line.match(TITLE_RE);
    if (t && !title) title = t[1];
    const f = line.match(FROM_RE);
    if (f && !uuid) uuid = f[1];
    // First non-empty line that isn't a heading or a blockquote → preview.
    if (!preview) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith(">")) {
        preview = trimmed.slice(0, 160);
      }
    }
  }

  return { title: title || file.replace(/\.md$/, ""), uuid, preview };
}

function dateFromFile(file: string): string | null {
  const m = file.match(FILENAME_DATE);
  return m ? m[1] : null;
}

/** List all harvest docs, newest first. Missing dir → empty list (not an error). */
export async function listHarvests(): Promise<HarvestSummary[]> {
  let files: string[];
  try {
    files = (await readdir(HARVEST_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    return []; // no harvests dir yet
  }

  const out: HarvestSummary[] = [];
  for (const file of files) {
    try {
      const full = join(HARVEST_DIR, file);
      const [raw, s] = await Promise.all([readFile(full, "utf-8"), stat(full)]);
      const { title, uuid, preview } = parseHeader(raw, file);
      out.push({
        file,
        title,
        uuid,
        date: dateFromFile(file),
        mtime: s.mtimeMs,
        size: s.size,
        preview,
      });
    } catch {
      // skip an unreadable file rather than failing the whole list
    }
  }

  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/**
 * Read one harvest doc by filename. The caller MUST have already validated
 * `file` with assertSafeSegment (no separators/traversal); here we add a
 * belt-and-suspenders containment check that the resolved path is still inside
 * HARVEST_DIR before reading. Returns null if absent/out-of-bounds.
 */
export async function readHarvest(file: string): Promise<HarvestDoc | null> {
  const full = resolve(HARVEST_DIR, file);
  // Containment: full must equal HARVEST_DIR/<something>, never escape it.
  const prefix = HARVEST_DIR.endsWith(sep) ? HARVEST_DIR : `${HARVEST_DIR}${sep}`;
  if (!full.startsWith(prefix)) return null;

  try {
    const raw = await readFile(full, "utf-8");
    const { title, uuid } = parseHeader(raw, file);
    return { file, title, uuid, date: dateFromFile(file), raw, location: full };
  } catch {
    return null;
  }
}

// Test: `bun server/coherence/harvests.ts [file]`
if (import.meta.main) {
  const [file] = process.argv.slice(2);
  if (file) {
    readHarvest(file).then((d) => console.log(JSON.stringify(d, null, 2)));
  } else {
    listHarvests().then((l) => console.log(JSON.stringify(l, null, 2)));
  }
}
