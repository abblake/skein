/**
 * Session Digest Generator
 *
 * Reads a PRD and generates a structured digest:
 * - What was explored
 * - What was discovered
 * - What was decided
 * - Open threads (questions, hypotheses, TODOs)
 *
 * Uses PAI Inference tool (Claude CLI) for AI synthesis.
 */

import { readFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";
import matter from "gray-matter";

const CLAUDE_DIR = join(homedir(), ".claude");
const MEMORY_DIR = join(CLAUDE_DIR, "MEMORY");
const SKEIN_DIR = join(CLAUDE_DIR, "skein");
const INFERENCE_TOOL = join(CLAUDE_DIR, "PAI", "TOOLS", "Inference.ts");

interface DigestResult {
  explored: string;
  discovered: string;
  decided: string;
  threads: Array<{
    type: "question" | "hypothesis" | "todo";
    text: string;
  }>;
}

/** Call PAI Inference tool */
async function callInference(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "bun",
      [INFERENCE_TOOL, "--level", "standard", "--json", "--timeout", "45000", systemPrompt, userPrompt],
      { timeout: 60_000 }
    );

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Inference failed (${code}): ${stderr}`));
    });
    proc.on("error", reject);
  });
}

/** Read and parse a PRD file */
async function readPrd(slug: string) {
  const raw = await readFile(join(MEMORY_DIR, "WORK", slug, "PRD.md"), "utf-8");
  const { data, content } = matter(raw);

  // Parse sections
  const sections: Record<string, string> = {};
  const lines = content.split("\n");
  let currentSection = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      if (currentSection) sections[currentSection] = currentContent.join("\n").trim();
      currentSection = match[1].toLowerCase();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }
  if (currentSection) sections[currentSection] = currentContent.join("\n").trim();

  return { frontmatter: data, sections };
}

/** Generate digest for a PRD using AI */
export async function generateDigest(slug: string): Promise<string> {
  const { frontmatter, sections } = await readPrd(slug);

  const systemPrompt = `You are a research session summarizer. Given a PRD (Product Requirements Document) from an academic researcher's AI-assisted work session, generate a structured digest.

Output ONLY valid JSON with this exact structure:
{
  "explored": "1-3 sentences describing what was explored/investigated in this session",
  "discovered": "1-3 sentences describing key findings, insights, or results",
  "decided": "1-3 sentences describing decisions made or conclusions reached",
  "threads": [
    {"type": "question", "text": "An open question raised but not answered"},
    {"type": "hypothesis", "text": "A hypothesis generated but not yet tested"},
    {"type": "todo", "text": "A task identified but not yet completed"}
  ]
}

For threads: only include genuine open items that weren't resolved. If criteria were all completed and the session is done, threads may be empty. Be specific — use names, methods, and concepts from the session. Keep language concise and direct.`;

  const userPrompt = `PRD for session: ${slug}

Task: ${frontmatter.task ?? "Unknown"}
Effort: ${frontmatter.effort ?? "standard"}
Phase: ${frontmatter.phase ?? "unknown"}
Progress: ${frontmatter.progress ?? "0/0"}

Context:
${sections.context ?? "(none)"}

Criteria:
${sections.criteria ?? "(none)"}

Decisions:
${sections.decisions ?? "(none)"}

Verification:
${sections.verification ?? "(none)"}`;

  const raw = await callInference(systemPrompt, userPrompt);

  // Extract JSON from response (may have markdown fences)
  let jsonStr = raw;
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1];

  // Try to find JSON object in the output
  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!objMatch) throw new Error("No JSON object found in inference output");

  const digest: DigestResult = JSON.parse(objMatch[0]);

  // Write digest file
  const digestDir = join(SKEIN_DIR, "digests", slug);
  await mkdir(digestDir, { recursive: true });

  const timestamp = new Date().toISOString();
  const filename = timestamp.replace(/[:.]/g, "-").slice(0, 19) + ".md";

  const threadLines = digest.threads
    .map((t) => {
      const prefix = t.type === "question" ? "?" : t.type === "hypothesis" ? ">" : "!";
      return `- ${prefix} ${t.text}`;
    })
    .join("\n");

  const digestContent = `---
session_slug: ${slug}
task: "${(frontmatter.task ?? "").replace(/"/g, '\\"')}"
timestamp: ${timestamp}
effort: ${frontmatter.effort ?? "standard"}
phase: ${frontmatter.phase ?? "unknown"}
progress: ${frontmatter.progress ?? "0/0"}
---

## What Was Explored
${digest.explored}

## What Was Discovered
${digest.discovered}

## What Was Decided
${digest.decided}

## Open Threads
${threadLines || "(none)"}
`;

  await writeFile(join(digestDir, filename), digestContent, "utf-8");

  return join(digestDir, filename);
}

/** Generate digests for multiple PRDs */
export async function batchGenerateDigests(
  slugs: string[],
  onProgress?: (slug: string, i: number, total: number) => void
): Promise<{ slug: string; path?: string; error?: string }[]> {
  const results = [];
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    onProgress?.(slug, i + 1, slugs.length);
    try {
      const path = await generateDigest(slug);
      results.push({ slug, path });
    } catch (err: any) {
      results.push({ slug, error: err.message });
    }
  }
  return results;
}
