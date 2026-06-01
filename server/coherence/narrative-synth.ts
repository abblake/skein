/**
 * Narrative Synthesizer
 *
 * Progressively synthesizes a living project narrative from session digests.
 * Each update reads existing narrative + new digests and produces an updated narrative.
 */

import { readFile, readdir, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";
import matter from "gray-matter";

const SKEIN_DIR = join(homedir(), ".claude", "skein");
const INFERENCE_TOOL = join(homedir(), ".claude", "PAI", "TOOLS", "Inference.ts");

async function callInference(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "bun",
      [INFERENCE_TOOL, "--level", "standard", "--timeout", "60000", systemPrompt, userPrompt],
      { timeout: 90_000 }
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

/** Read all digests for a session, sorted chronologically */
async function readDigests(slug: string): Promise<string[]> {
  const digestDir = join(SKEIN_DIR, "digests", slug);
  try {
    const files = await readdir(digestDir);
    const contents: string[] = [];
    for (const file of files.filter((f) => f.endsWith(".md")).sort()) {
      const raw = await readFile(join(digestDir, file), "utf-8");
      contents.push(raw);
    }
    return contents;
  } catch {
    return [];
  }
}

/** Load existing narrative */
export async function loadNarrative(slug: string): Promise<string | null> {
  try {
    const raw = await readFile(
      join(SKEIN_DIR, "narratives", `${slug}.md`),
      "utf-8"
    );
    const { content } = matter(raw);
    return content.trim();
  } catch {
    return null;
  }
}

/** Generate or update the narrative for a session */
export async function synthesizeNarrative(slug: string): Promise<string> {
  const digests = await readDigests(slug);
  if (digests.length === 0) {
    return "No session digests available yet. Generate digests first to build a narrative.";
  }

  const existingNarrative = await loadNarrative(slug);
  const digestSummaries = digests.map((d) => {
    const { data, content } = matter(d);
    return `[${data.timestamp ?? "unknown date"}] ${data.task ?? slug}\n${content.trim()}`;
  });

  const systemPrompt = `You are a research narrative synthesizer. Given session digests from an academic researcher's work, produce a cohesive narrative that tells the story of this research project.

${existingNarrative ? "An existing narrative is provided — UPDATE it with new information rather than rewriting from scratch. Preserve the researcher's edits if any." : "This is the first narrative — create it from scratch."}

Rules:
- Write in third person past tense ("The researcher explored...", "Analysis revealed...")
- Be specific — use actual methods, findings, paper names, and concepts
- Organize chronologically but group related work into coherent paragraphs
- Highlight pivots, surprises, and key decisions
- Keep it concise — 2-5 paragraphs depending on how much material there is
- End with current status and likely next directions

Output ONLY the narrative text, no JSON, no frontmatter, no markdown headers.`;

  const userPrompt = `SESSION: ${slug}

${existingNarrative ? `EXISTING NARRATIVE:\n${existingNarrative}\n\n` : ""}SESSION DIGESTS (chronological):
${digestSummaries.join("\n\n---\n\n")}`;

  const narrative = await callInference(systemPrompt, userPrompt);

  // Save narrative
  const narrativesDir = join(SKEIN_DIR, "narratives");
  await mkdir(narrativesDir, { recursive: true });

  const frontmatter = `---
slug: ${slug}
lastUpdated: ${new Date().toISOString()}
digestCount: ${digests.length}
---

`;

  await writeFile(
    join(narrativesDir, `${slug}.md`),
    frontmatter + narrative,
    "utf-8"
  );

  return narrative;
}
