/**
 * Harvest-to-Skill — ③ (second half) of the Hermes/PAI roadmap.
 *
 * Turns a thread's work into a reusable skill/knowledge doc (Hermes'
 * "auto-generated skill documents"). Writes to Skein-owned ~/.claude/skein/harvests/
 * — NEVER into PAI's MEMORY/skills (data contract). You promote a good harvest to
 * a real PAI skill yourself. On-demand (user clicks), so it uses a stronger model.
 */

import { execFile } from "child_process";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { buildTranscript } from "./digest";

const HOME = homedir();
const HARVEST_DIR = join(HOME, ".claude", "skein", "harvests");
const INFERENCE = join(HOME, ".claude", "PAI", "TOOLS", "Inference.ts");

const HARVEST_SYS =
  "You distill a work session into a reusable skill document for future reference. " +
  "Output GitHub-flavored markdown with exactly these sections: " +
  "## Problem (1-2 sentences), ## Approach (what worked, concise), " +
  "## Key Steps (numbered, concrete, copy-pasteable where relevant), " +
  "## Pitfalls (what to avoid / what failed first), ## Verification (how you know it worked). " +
  "Be specific and technical. Omit a section only if the session truly has nothing for it. No preamble.";

function runInference(sys: string, user: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "bun",
      [INFERENCE, "--level", "standard", "--timeout", "60000", sys, user],
      { timeout: 75000 },
      (err, stdout) => resolve(err ? "" : stdout.trim()),
    );
  });
}

/** Generate a skill doc from a thread and write it to the harvests dir. */
export async function harvestThread(
  card: { id: string; uuid: string; title: string; projectId: string },
): Promise<{ ok: boolean; path?: string; preview?: string; detail?: string }> {
  const transcript = await buildTranscript(card.projectId, card.uuid);
  if (!transcript) return { ok: false, detail: "no transcript to harvest" };

  const body = await runInference(HARVEST_SYS, `THREAD: ${card.title}\n\nSESSION:\n${transcript}`);
  if (!body) return { ok: false, detail: "harvest generation failed" };

  const stamp = new Date().toISOString().slice(0, 10);
  const safe = card.id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60);
  const path = join(HARVEST_DIR, `${stamp}-${safe}.md`);
  const doc = `# Harvest: ${card.title}\n\n> From thread ${card.uuid} · ${new Date().toISOString()}\n> Promote to a PAI skill if it earns its keep.\n\n${body}\n`;

  await mkdir(HARVEST_DIR, { recursive: true });
  await writeFile(path, doc, "utf-8");
  return { ok: true, path, preview: body.slice(0, 200) };
}

// Test: `bun server/coherence/harvest.ts <slug> <uuid> <title>`
if (import.meta.main) {
  const [slug, uuid, ...title] = process.argv.slice(2);
  harvestThread({ id: `test-${uuid}`, uuid, title: title.join(" ") || "test", projectId: slug })
    .then((r) => console.log(JSON.stringify(r, null, 2)));
}
