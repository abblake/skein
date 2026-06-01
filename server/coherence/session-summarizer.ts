/**
 * Session Summarizer
 *
 * Reads Claude JSONL conversation logs and extracts rich summaries
 * suitable for briefing and narrative generation.
 *
 * Designed to be fast: reads only user messages (skips large assistant
 * responses), samples strategically (first 3 + last 3 messages).
 */

import { readFile, readdir, stat } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

export interface SessionSummary {
  uuid: string;
  startedAt: string;
  lastMessageAt: string;
  userMessageCount: number;
  /** First 3 user messages — captures initial intent */
  openingMessages: string[];
  /** Last 3 user messages — captures where they left off */
  closingMessages: string[];
  /** All unique tool names used (from assistant tool_use blocks) */
  toolsUsed: string[];
}

/** Extract user messages from a JSONL file — lightweight scan */
function extractUserMessages(raw: string): {
  messages: Array<{ text: string; timestamp: string }>;
  tools: Set<string>;
  firstTs: string;
  lastTs: string;
} {
  const messages: Array<{ text: string; timestamp: string }> = [];
  const tools = new Set<string>();
  let firstTs = "";
  let lastTs = "";

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      const ts = d.timestamp ?? "";
      if (!firstTs && ts) firstTs = ts;
      if (ts) lastTs = ts;

      if (d.type === "user") {
        const content = d.message?.content ?? "";
        let text = "";
        if (typeof content === "string") {
          text = content;
        } else if (Array.isArray(content)) {
          text = content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text ?? "")
            .join(" ");
        }
        // Clean up system tags
        text = text
          .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
          .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
          .replace(/<command-name>[^<]*<\/command-name>/g, "")
          .replace(/<command-message>[^<]*<\/command-message>/g, "")
          .replace(/<command-args>/g, "")
          .replace(/<\/command-args>/g, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (text.length > 10) {
          messages.push({ text: text.slice(0, 300), timestamp: ts });
        }
      }

      // Extract tool names from assistant messages
      if (d.type === "assistant" && d.message?.content) {
        const content = d.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_use" && block.name) {
              tools.add(block.name);
            }
          }
        }
      }
    } catch {
      // skip bad lines
    }
  }

  return { messages, tools, firstTs, lastTs };
}

/** Get rich summaries for the N most recent sessions in a project */
export async function getSessionSummaries(
  claudeProjectId: string,
  limit: number = 5
): Promise<SessionSummary[]> {
  const projectDir = join(PROJECTS_DIR, claudeProjectId);

  try {
    const entries = await readdir(projectDir, { withFileTypes: true });
    const jsonlFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => ({ name: e.name, path: join(projectDir, e.name) }));

    // Sort by mtime, most recent first
    const withMtimes = await Promise.all(
      jsonlFiles.map(async (f) => {
        try {
          const s = await stat(f.path);
          return { ...f, mtime: s.mtimeMs };
        } catch {
          return { ...f, mtime: 0 };
        }
      })
    );
    withMtimes.sort((a, b) => b.mtime - a.mtime);

    const results: SessionSummary[] = [];

    for (const file of withMtimes.slice(0, limit)) {
      try {
        const raw = await readFile(file.path, "utf-8");
        const { messages, tools, firstTs, lastTs } = extractUserMessages(raw);

        if (messages.length === 0) continue;

        // First 3 + last 3 (may overlap for short sessions)
        const opening = messages.slice(0, 3).map((m) => m.text);
        const closing = messages.slice(-3).map((m) => m.text);

        results.push({
          uuid: basename(file.name, ".jsonl"),
          startedAt: firstTs,
          lastMessageAt: lastTs,
          userMessageCount: messages.length,
          openingMessages: opening,
          closingMessages: closing,
          toolsUsed: Array.from(tools).slice(0, 15),
        });
      } catch {
        // skip unreadable files
      }
    }

    return results;
  } catch {
    return [];
  }
}

/** Build a text block suitable for AI synthesis from session summaries */
export function buildSynthesisContext(summaries: SessionSummary[]): string {
  if (summaries.length === 0) return "(no session data available)";

  const blocks = summaries.map((s, i) => {
    const when = s.startedAt
      ? new Date(s.startedAt).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : "unknown date";

    const opening = s.openingMessages.join("\n  ");
    const closing =
      s.closingMessages[s.closingMessages.length - 1] !== s.openingMessages[0]
        ? `\n  Last: ${s.closingMessages[s.closingMessages.length - 1]}`
        : "";
    const tools = s.toolsUsed.length > 0 ? `\n  Tools: ${s.toolsUsed.join(", ")}` : "";

    return `Session ${i + 1} (${when}, ${s.userMessageCount} messages):
  ${opening}${closing}${tools}`;
  });

  return blocks.join("\n\n");
}
