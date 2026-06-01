import { readFile, realpath } from "fs/promises";
import { homedir } from "os";
import { isAbsolute, join, resolve, sep } from "path";

const HOME_DIR = homedir();
const LIVE_STATE_FILE = join(HOME_DIR, ".claude", "skein", "live-state.json");

/**
 * Reject a single path segment that came from a client-controlled route param
 * before it is interpolated into a filesystem `join`. Hono URL-decodes path
 * params, so `%2e%2e%2f` arrives as `../` — guard the DECODED value.
 *
 * Mangled Claude project ids legitimately start with `-` and contain only
 * `[A-Za-z0-9-]`, so a leading dash is fine. We reject traversal (`..`), path
 * separators, null bytes, and absolute-path forms. Returns the segment so it
 * can be used inline: `const slug = assertSafeSegment(c.req.param("slug"))`.
 *
 * Throws on violation; callers map the throw to HTTP 400.
 */
export function assertSafeSegment(seg: string | undefined): string {
  if (typeof seg !== "string" || seg.length === 0) {
    throw new Error("missing path segment");
  }
  if (seg.includes("\0")) throw new Error("path segment contains null byte");
  if (seg.includes("/") || seg.includes("\\")) {
    throw new Error("path segment contains a separator");
  }
  if (seg === ".." || seg === "." || seg.split(/[\\/]/).includes("..")) {
    throw new Error("path segment traverses directories");
  }
  if (isAbsolute(seg)) throw new Error("path segment must not be absolute");
  return seg;
}

function isWithin(parent: string, candidate: string): boolean {
  if (candidate === parent) return true;
  const prefix = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return candidate.startsWith(prefix);
}

async function canonicalize(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function loadObservedProjectDirs(): Promise<string[]> {
  try {
    const raw = JSON.parse(await readFile(LIVE_STATE_FILE, "utf-8")) as {
      activeSessions?: Array<{ projectDirectory?: string }>;
    };
    const dirs = await Promise.all(
      (raw.activeSessions ?? [])
        .map((session) => session.projectDirectory)
        .filter((dir): dir is string => typeof dir === "string" && dir.length > 0)
        .map((dir) => canonicalize(dir))
    );
    return [...new Set(dirs)];
  } catch {
    return [];
  }
}

export async function validateNotepadDir(input: unknown): Promise<string> {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("missing dir");
  }
  if (input.includes("\0")) {
    throw new Error("dir contains null byte");
  }
  if (!isAbsolute(input)) {
    throw new Error("dir must be absolute");
  }

  const lexical = resolve(input);

  let resolved: string;
  try {
    resolved = await realpath(input);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      if (isWithin(HOME_DIR, lexical)) return input;
      throw new Error("dir is outside allowed roots");
    }
    throw new Error("dir could not be resolved");
  }

  if (isWithin(HOME_DIR, resolved)) return input;

  const observedDirs = await loadObservedProjectDirs();
  if (observedDirs.some((dir) => isWithin(dir, resolved))) {
    return input;
  }

  throw new Error("dir is outside allowed roots");
}
