/**
 * Project Coherence Generator
 *
 * Generates briefings and narratives for ANY project by reading
 * Claude's JSONL conversation logs directly. Does NOT require PRDs.
 *
 * This is the fix for the fundamental issue: 99% of sessions don't
 * have PRDs, but they all have JSONL conversation data.
 */

import { mkdir, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";
import { getSessionSummaries, buildSynthesisContext } from "./session-summarizer";

const SKEIN_DIR = join(homedir(), ".claude", "skein");
const INFERENCE_TOOL = join(homedir(), ".claude", "PAI", "TOOLS", "Inference.ts");

async function callInference(system: string, user: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "bun",
      [INFERENCE_TOOL, "--level", "standard", "--timeout", "60000", system, user],
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

function extractJson(raw: string): any {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1] : raw;
  const match = jsonStr.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found");
  return JSON.parse(match[0]);
}

// === PROJECT BRIEFING ===

export interface ProjectBriefing {
  projectName: string;
  claudeProjectId: string;
  generatedAt: string;
  whereYouLeftOff: string;
  keyTopics: string[];
  recentActivity: string[];
  openQuestions: string[];
  sessionCount: number;
}

export async function generateProjectBriefing(
  claudeProjectId: string,
  projectName: string
): Promise<ProjectBriefing> {
  const summaries = await getSessionSummaries(claudeProjectId, 7);
  const context = buildSynthesisContext(summaries);

  const system = `You are a research re-onboarding assistant. Given summaries of recent Claude Code sessions from a research project, generate a briefing to help the researcher remember what's happening.

Output ONLY valid JSON:
{
  "whereYouLeftOff": "2-3 sentences: what was the researcher most recently working on?",
  "keyTopics": ["topic 1 they've been exploring", "topic 2", "topic 3"],
  "recentActivity": ["What they did in the most recent session (1 sentence)", "What they did in the session before that"],
  "openQuestions": ["An unresolved question from the sessions", "Another open thread"]
}

Be SPECIFIC — use actual names, methods, data sources, and concepts from the session content. Don't be generic. If the sessions show someone working on a paper, name the paper topic. If they're running analyses, name the method. Max 4 items per array.`;

  const user = `Project: ${projectName}
Total sessions: ${summaries.reduce((s, x) => s + x.userMessageCount, 0)} user messages across ${summaries.length} recent sessions

${context}`;

  const raw = await callInference(system, user);
  const parsed = extractJson(raw);

  const briefing: ProjectBriefing = {
    projectName,
    claudeProjectId,
    generatedAt: new Date().toISOString(),
    whereYouLeftOff: parsed.whereYouLeftOff ?? "",
    keyTopics: parsed.keyTopics ?? [],
    recentActivity: parsed.recentActivity ?? [],
    openQuestions: parsed.openQuestions ?? [],
    sessionCount: summaries.length,
  };

  // Cache
  const dir = join(SKEIN_DIR, "project-briefings");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${claudeProjectId}.json`),
    JSON.stringify(briefing, null, 2),
    "utf-8"
  );

  return briefing;
}

export async function loadProjectBriefing(
  claudeProjectId: string
): Promise<ProjectBriefing | null> {
  try {
    const raw = await readFile(
      join(SKEIN_DIR, "project-briefings", `${claudeProjectId}.json`),
      "utf-8"
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// === PROJECT NARRATIVE ===

export interface ProjectNarrative {
  projectName: string;
  claudeProjectId: string;
  generatedAt: string;
  narrative: string;
  sessionCount: number;
}

export async function generateProjectNarrative(
  claudeProjectId: string,
  projectName: string
): Promise<ProjectNarrative> {
  const summaries = await getSessionSummaries(claudeProjectId, 10);
  const context = buildSynthesisContext(summaries);

  // Check for existing narrative
  let existing = "";
  try {
    const raw = await readFile(
      join(SKEIN_DIR, "project-narratives", `${claudeProjectId}.md`),
      "utf-8"
    );
    existing = raw;
  } catch { /* no existing */ }

  const system = `You are a research narrative synthesizer. Given session summaries from a researcher's Claude Code usage, write a concise narrative of what this research project involves and how it has progressed.

${existing ? "An existing narrative is provided — UPDATE it with new information." : "Write a fresh narrative."}

Rules:
- 2-4 paragraphs
- Third person past tense ("The researcher explored...", "Sessions focused on...")
- Be SPECIFIC — name methods, papers, data sources, analyses
- Organize by theme, not strictly chronologically
- End with current status and likely next directions
- Output ONLY the narrative text, no JSON, no headers`;

  const user = `Project: ${projectName}
${summaries.length} recent sessions analyzed

${existing ? `EXISTING NARRATIVE:\n${existing}\n\n` : ""}SESSION DATA:
${context}`;

  const narrative = await callInference(system, user);

  const result: ProjectNarrative = {
    projectName,
    claudeProjectId,
    generatedAt: new Date().toISOString(),
    narrative,
    sessionCount: summaries.length,
  };

  // Cache
  const dir = join(SKEIN_DIR, "project-narratives");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${claudeProjectId}.md`), narrative, "utf-8");
  await writeFile(
    join(dir, `${claudeProjectId}.json`),
    JSON.stringify(result, null, 2),
    "utf-8"
  );

  return result;
}

export async function loadProjectNarrative(
  claudeProjectId: string
): Promise<ProjectNarrative | null> {
  try {
    const raw = await readFile(
      join(SKEIN_DIR, "project-narratives", `${claudeProjectId}.json`),
      "utf-8"
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
