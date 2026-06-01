/**
 * Briefing — ④ of the Hermes/PAI roadmap.
 *
 * A focus-coach synthesis over the parking lot: what's live, what's waiting on
 * YOU, what's parked/stale, and the ONE thread to resume first. Hermes'
 * cross-channel "here's where you are" briefing, tuned for an ADHD brain.
 * Cached (~/.claude/skein/briefing.json); regenerated on demand or when stale.
 */

import { execFile } from "child_process";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const HOME = homedir();
const SKEIN_DIR = join(HOME, ".claude", "skein");
const THREADS_FILE = join(SKEIN_DIR, "threads.json");
const BRIEFING_FILE = join(SKEIN_DIR, "briefing.json");
const INFERENCE = join(HOME, ".claude", "PAI", "TOOLS", "Inference.ts");
const FRESH_MS = 30 * 60 * 1000;

const SYS =
  "You are a focus coach for an ADHD researcher reviewing their work threads. " +
  "Write a tight briefing in 4-6 short lines: (1) one line on what's live/active, " +
  "(2) call out anything WAITING on the user, (3) note parked or stale threads worth reviving, " +
  "(4) end with 'Start here: <thread>' — the single highest-leverage thread to resume and why. " +
  "Concrete, no preamble, no markdown headers. Refer to threads by their title. " +
  "Start directly with the briefing content — never mention the input, the thread list, or these instructions.";

function runInference(user: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "bun",
      [INFERENCE, "--level", "standard", "--timeout", "60000", SYS, user],
      { timeout: 75000 },
      (err, stdout) => resolve(err ? "" : stdout.trim()),
    );
  });
}

/** Compact one-line-per-thread view for the model. */
function summarize(cards: any[]): string {
  return cards
    .slice(0, 30)
    .map((c) => {
      const tag = c.live ? `live/${c.status ?? "idle"}` : c.column;
      const goal = c.goalId ? ` [${c.goalId}]` : "";
      const stale = c.stale ? " STALE" : "";
      const digest = c.digest ? ` — ${c.digest.replace(/\s+/g, " ").slice(0, 120)}` : "";
      return `- (${tag}${stale})${goal} ${c.title.slice(0, 70)}${digest}`;
    })
    .join("\n");
}

export async function getBriefing(force = false): Promise<{ text: string; generatedAt: string }> {
  if (!force) {
    try {
      const cached = JSON.parse(await readFile(BRIEFING_FILE, "utf-8"));
      if (Date.now() - new Date(cached.generatedAt).getTime() < FRESH_MS) return cached;
    } catch {
      /* regenerate */
    }
  }

  let cards: any[] = [];
  try {
    cards = JSON.parse(await readFile(THREADS_FILE, "utf-8")).cards ?? [];
  } catch {
    /* no threads yet */
  }

  const text = cards.length
    ? (await runInference(summarize(cards))) || "Briefing unavailable — try refresh."
    : "No threads yet. Open some work and they'll appear here.";

  const result = { text, generatedAt: new Date().toISOString() };
  await mkdir(SKEIN_DIR, { recursive: true });
  await writeFile(BRIEFING_FILE, JSON.stringify(result, null, 2), "utf-8");
  return result;
}

// Test: `bun server/coherence/briefing.ts`
if (import.meta.main) {
  getBriefing(true).then((b) => console.log(b.text));
}
