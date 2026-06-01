/**
 * Re-onboarding Briefing Generator
 *
 * Synthesizes a "here's where you left off" briefing from:
 * - Recent digests for this session
 * - Current PRD state
 * - Open threads
 *
 * Uses PAI Inference tool for AI synthesis.
 */

import { readFile, readdir, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";
import { extractThreadsForSession } from "./thread-extractor";

const CLAUDE_DIR = join(homedir(), ".claude");
const MEMORY_DIR = join(CLAUDE_DIR, "MEMORY");
const SKEIN_DIR = join(CLAUDE_DIR, "skein");
const INFERENCE_TOOL = join(CLAUDE_DIR, "PAI", "TOOLS", "Inference.ts");

async function callInference(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "bun",
      [INFERENCE_TOOL, "--level", "standard", "--timeout", "45000", systemPrompt, userPrompt],
      { timeout: 60_000 }
    );

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code: number | null) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Inference failed (${code}): ${stderr}`));
    });
    proc.on("error", reject);
  });
}

export interface Briefing {
  slug: string;
  generatedAt: string;
  whereYouLeftOff: string;
  keyDiscoveries: string[];
  suggestedNextSteps: string[];
  openQuestions: string[];
}

/** Generate a re-onboarding briefing for a session */
export async function generateBriefing(slug: string): Promise<Briefing> {
  // 1. Read PRD
  let prdContent = "";
  try {
    const raw = await readFile(
      join(MEMORY_DIR, "WORK", slug, "PRD.md"),
      "utf-8"
    );
    prdContent = raw;
  } catch {
    prdContent = "(no PRD found)";
  }

  // 2. Read recent digests
  let digestContent = "";
  try {
    const digestDir = join(SKEIN_DIR, "digests", slug);
    const files = await readdir(digestDir);
    const digestFiles = files.filter((f) => f.endsWith(".md")).sort().reverse().slice(0, 3);

    for (const file of digestFiles) {
      const raw = await readFile(join(digestDir, file), "utf-8");
      digestContent += raw + "\n---\n";
    }
  } catch {
    digestContent = "(no digests yet)";
  }

  // 3. Read open threads
  const threads = await extractThreadsForSession(slug);
  const openThreads = threads.filter((t) => t.status === "open");
  const threadsSummary = openThreads.length > 0
    ? openThreads.map((t) => `- [${t.type}] ${t.text}`).join("\n")
    : "(no open threads)";

  // 4. Call AI for synthesis
  const systemPrompt = `You are a research session re-onboarding assistant. A researcher is returning to a project after time away. Generate a brief, direct re-onboarding briefing that helps them remember where they were and what to do next.

Output ONLY valid JSON:
{
  "whereYouLeftOff": "2-3 sentences about what was happening when the session ended",
  "keyDiscoveries": ["discovery 1", "discovery 2", "discovery 3"],
  "suggestedNextSteps": ["next step 1", "next step 2"],
  "openQuestions": ["question 1", "question 2"]
}

Be specific — use actual names, methods, findings from the data. Keep each item concise (1 sentence). Maximum 3 discoveries, 3 next steps, 3 questions.`;

  const userPrompt = `SESSION: ${slug}

PRD:
${prdContent.slice(0, 2000)}

RECENT DIGESTS:
${digestContent.slice(0, 2000)}

OPEN THREADS:
${threadsSummary}`;

  const raw = await callInference(systemPrompt, userPrompt);

  // Parse JSON from response
  let jsonStr = raw;
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1];
  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!objMatch) throw new Error("No JSON found in briefing output");

  const parsed = JSON.parse(objMatch[0]);

  const briefing: Briefing = {
    slug,
    generatedAt: new Date().toISOString(),
    whereYouLeftOff: parsed.whereYouLeftOff ?? "",
    keyDiscoveries: parsed.keyDiscoveries ?? [],
    suggestedNextSteps: parsed.suggestedNextSteps ?? [],
    openQuestions: parsed.openQuestions ?? [],
  };

  // Cache the briefing
  const briefingDir = join(SKEIN_DIR, "briefings");
  await mkdir(briefingDir, { recursive: true });
  await writeFile(
    join(briefingDir, `${slug}.json`),
    JSON.stringify(briefing, null, 2),
    "utf-8"
  );

  return briefing;
}

/** Load cached briefing */
export async function loadBriefing(slug: string): Promise<Briefing | null> {
  try {
    const raw = await readFile(
      join(SKEIN_DIR, "briefings", `${slug}.json`),
      "utf-8"
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
