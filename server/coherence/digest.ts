/**
 * Digest-on-Park — ② keystone of the Hermes/PAI roadmap (Plans/parking-lot.md).
 *
 * When a window closes, summarize what the thread accomplished so a parked card
 * is a MEMORY ("explored X, left at Y"), not just its opening prompt. This is
 * the "never forgets how it solved a problem" payoff — and it feeds the briefing,
 * search, and harvest features downstream.
 *
 * Generation is async + fire-and-forget: the 10s capture scan must stay fast,
 * so it kicks off a digest and patches threads.json when the LLM returns.
 * Uses PAI's sanctioned Inference.ts (claude --print via fast/haiku), never a
 * nested interactive session.
 */

import { execFile } from "child_process";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const HOME = homedir();
const PROJECTS_DIR = join(HOME, ".claude", "projects");
const THREADS_FILE = join(HOME, ".claude", "skein", "threads.json");
const INFERENCE = join(HOME, ".claude", "PAI", "TOOLS", "Inference.ts");

const DIGEST_SYS =
  "You write a 2-line digest of a work/coding session for a card on a dashboard. " +
  "Line 1: what the session worked on. Line 2: where it was left / the open thread or next step. " +
  "Be concrete and specific. No preamble, no markdown, max 28 words total.";

// Sessions currently being digested — avoid duplicate concurrent generations,
// and cap total concurrency so a first scan doesn't burst 12 LLM subprocesses.
const inFlight = new Set<string>();
const MAX_CONCURRENT = 3;

/** Extract a compact transcript (head + recent tail) from a session .jsonl. */
export async function buildTranscript(slug: string, uuid: string): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(join(PROJECTS_DIR, slug, `${uuid}.jsonl`), "utf-8");
  } catch {
    return "";
  }
  const turns: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    const role = obj?.message?.role ?? obj?.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = obj?.message?.content ?? obj?.content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.filter((c: any) => typeof c?.text === "string").map((c: any) => c.text).join(" ")
        : "";
    if (!text.trim()) continue;
    // Drop slash-command wrappers and injected noise for a cleaner signal.
    if (/^<command-|^<system-reminder|^This session is being continued|^Caveat:/.test(text.trim())) continue;
    turns.push(`${role === "user" ? "USER" : "AI"}: ${text.replace(/\s+/g, " ").trim().slice(0, 400)}`);
  }
  if (turns.length === 0) return "";
  // Head (first turn) + recent tail keeps the prompt small but representative.
  const head = turns.slice(0, 1);
  const tail = turns.slice(-8);
  return [...head, ...(turns.length > 9 ? ["..."] : []), ...tail].join("\n").slice(0, 8000);
}

function runInference(user: string): Promise<string> {
  return new Promise((resolve) => {
    // Inference.ts defaults fast→15s internally; a cold markdown prompt exceeds
    // it, so raise the budget explicitly (and the outer execFile timeout above it).
    execFile(
      "bun",
      [INFERENCE, "--level", "fast", "--timeout", "45000", DIGEST_SYS, user],
      { timeout: 55000 },
      (err, stdout) => resolve(err ? "" : stdout.trim()),
    );
  });
}

/** Patch a single card's digest in threads.json (read-modify-write). */
async function patchDigest(id: string, digest: string): Promise<void> {
  // capture preserves the digest field on later scans, so a write here persists;
  // if a concurrent capture clobbers it, the next scan re-fires generation.
  try {
    const store = JSON.parse(await readFile(THREADS_FILE, "utf-8"));
    const card = store.cards?.find((c: any) => c.id === id);
    if (!card) return;
    card.digest = digest;
    card.digestAt = new Date().toISOString();
    await writeFile(THREADS_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch {
    /* next scan will retry */
  }
}

/**
 * Ensure a parked card has a digest. Fire-and-forget: returns immediately,
 * generates in the background, patches threads.json on completion.
 */
export function ensureDigest(card: { id: string; uuid: string; projectId: string }): void {
  if (inFlight.has(card.id)) return;
  if (inFlight.size >= MAX_CONCURRENT) return; // at cap; next scan retries
  inFlight.add(card.id);
  (async () => {
    try {
      const transcript = await buildTranscript(card.projectId, card.uuid);
      if (!transcript) return;
      const digest = await runInference(transcript);
      if (digest) await patchDigest(card.id, digest);
    } catch {
      /* leave undigested; next scan retries */
    } finally {
      inFlight.delete(card.id);
    }
  })();
}

// Test: `bun server/coherence/digest.ts <slug> <uuid>`
if (import.meta.main) {
  const [slug, uuid] = process.argv.slice(2);
  buildTranscript(slug, uuid)
    .then((t) => (t ? runInference(t) : "(no transcript)"))
    .then((d) => console.log("DIGEST:\n" + d));
}
