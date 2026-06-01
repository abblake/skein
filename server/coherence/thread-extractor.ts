/**
 * Thread Extractor
 *
 * Parses open threads from digest files and maintains a tracked
 * threads JSON file per session slug. Threads have types
 * (question/hypothesis/todo) and statuses (open/resolved/stale).
 */

import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import matter from "gray-matter";

const SKEIN_DIR = join(homedir(), ".claude", "skein");

export interface TrackedThread {
  id: string;
  type: "question" | "hypothesis" | "todo";
  text: string;
  sourceSession: string;
  sourceDate: string;
  status: "open" | "resolved" | "stale";
  resolvedIn?: string;
  resolvedDate?: string;
}

interface ThreadsFile {
  slug: string;
  lastUpdated: string;
  threads: TrackedThread[];
}

/** Parse thread lines from a digest's "Open Threads" section */
function parseThreadLines(
  text: string,
  slug: string,
  timestamp: string
): TrackedThread[] {
  if (!text || text.trim() === "(none)") return [];

  return text
    .split("\n")
    .filter((line) => line.match(/^- [?!>]/))
    .map((line, i) => {
      const prefix = line.charAt(2);
      const type: TrackedThread["type"] =
        prefix === "?" ? "question" : prefix === ">" ? "hypothesis" : "todo";
      const text = line.slice(4).trim();

      return {
        id: `${slug}-${i}`,
        type,
        text,
        sourceSession: slug,
        sourceDate: timestamp,
        status: "open" as const,
      };
    });
}

/** Extract threads from all digests for a given session slug */
export async function extractThreadsForSession(
  slug: string
): Promise<TrackedThread[]> {
  const digestDir = join(SKEIN_DIR, "digests", slug);
  const threads: TrackedThread[] = [];

  try {
    const files = await readdir(digestDir);
    for (const file of files.filter((f) => f.endsWith(".md"))) {
      const raw = await readFile(join(digestDir, file), "utf-8");
      const { data, content } = matter(raw);

      // Parse sections
      const lines = content.split("\n");
      let inThreads = false;
      let threadText = "";

      for (const line of lines) {
        if (line.match(/^## Open Threads/)) {
          inThreads = true;
          continue;
        }
        if (line.match(/^## /) && inThreads) break;
        if (inThreads) threadText += line + "\n";
      }

      const parsed = parseThreadLines(
        threadText,
        slug,
        (data.timestamp as string) ?? new Date().toISOString()
      );
      threads.push(...parsed);
    }
  } catch {
    // no digests
  }

  return threads;
}

/** Extract threads from ALL digests across all sessions */
export async function extractAllThreads(): Promise<TrackedThread[]> {
  const digestsDir = join(SKEIN_DIR, "digests");
  const allThreads: TrackedThread[] = [];

  try {
    const slugDirs = await readdir(digestsDir);
    for (const slug of slugDirs) {
      const threads = await extractThreadsForSession(slug);
      allThreads.push(...threads);
    }
  } catch {
    // no digests dir
  }

  // Sort by date, newest first
  allThreads.sort(
    (a, b) =>
      new Date(b.sourceDate).getTime() - new Date(a.sourceDate).getTime()
  );

  return allThreads;
}

/** Mark threads as stale if older than N days */
export function markStaleThreads(
  threads: TrackedThread[],
  staleDays: number = 7
): TrackedThread[] {
  const cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  return threads.map((t) => {
    if (
      t.status === "open" &&
      new Date(t.sourceDate).getTime() < cutoff
    ) {
      return { ...t, status: "stale" as const };
    }
    return t;
  });
}

/** Save tracked threads to a JSON file */
export async function saveThreads(
  slug: string,
  threads: TrackedThread[]
): Promise<void> {
  const threadsDir = join(SKEIN_DIR, "threads");
  await mkdir(threadsDir, { recursive: true });

  const data: ThreadsFile = {
    slug,
    lastUpdated: new Date().toISOString(),
    threads,
  };

  await writeFile(
    join(threadsDir, `${slug}.json`),
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}

/** Load tracked threads from JSON file */
export async function loadThreads(
  slug: string
): Promise<TrackedThread[]> {
  try {
    const raw = await readFile(
      join(SKEIN_DIR, "threads", `${slug}.json`),
      "utf-8"
    );
    const data: ThreadsFile = JSON.parse(raw);
    return data.threads;
  } catch {
    return [];
  }
}
