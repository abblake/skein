/**
 * Todoist Live Fetch Proxy
 *
 * Reads TODOIST_API_TOKEN from ~/.claude.json (where the Todoist MCP stores it)
 * and proxies tasks + sections for a project. 30s in-memory cache per project_id
 * to avoid hammering the API on UI re-renders.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const HOME = homedir();
const CLAUDE_JSON = join(HOME, ".claude.json");

interface TodoistTask {
  id: string;
  project_id: string;
  section_id: string | null;
  content: string;
  description: string;
  labels: string[];
  priority: number;
  checked: boolean;
  due?: { date: string; string: string } | null;
}

interface TodoistSection {
  id: string;
  project_id: string;
  name: string;
  order: number;
}

export interface TodoistProjectSnapshot {
  tasks: TodoistTask[];
  sections: TodoistSection[];
  fetchedAt: string;
  cached: boolean;
}

let tokenCache: { token: string | null; loadedAt: number } | null = null;

async function getToken(): Promise<string | null> {
  // Re-read once per minute so user can rotate token without restart
  if (tokenCache && Date.now() - tokenCache.loadedAt < 60_000) {
    return tokenCache.token;
  }
  try {
    const raw = await readFile(CLAUDE_JSON, "utf-8");
    const data = JSON.parse(raw);
    const token =
      data?.mcpServers?.todoist?.env?.TODOIST_API_TOKEN ??
      process.env.TODOIST_API_TOKEN ??
      null;
    tokenCache = { token, loadedAt: Date.now() };
    return token;
  } catch {
    tokenCache = { token: null, loadedAt: Date.now() };
    return null;
  }
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { data: TodoistProjectSnapshot; storedAt: number }>();

export class TodoistProxyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getProjectTasks(
  projectId: string,
  bypassCache = false
): Promise<TodoistProjectSnapshot> {
  if (!bypassCache) {
    const hit = cache.get(projectId);
    if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) {
      return { ...hit.data, cached: true };
    }
  }

  const token = await getToken();
  if (!token) {
    throw new TodoistProxyError(
      503,
      "TODOIST_API_TOKEN not found in ~/.claude.json (mcpServers.todoist.env) or process env"
    );
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };

  const [tasksRes, sectionsRes] = await Promise.all([
    fetch(
      `https://api.todoist.com/api/v1/tasks?project_id=${encodeURIComponent(projectId)}`,
      { headers }
    ),
    fetch(
      `https://api.todoist.com/api/v1/sections?project_id=${encodeURIComponent(projectId)}`,
      { headers }
    ),
  ]);

  if (!tasksRes.ok) {
    throw new TodoistProxyError(
      502,
      `Todoist /tasks returned ${tasksRes.status}: ${await tasksRes.text()}`
    );
  }
  if (!sectionsRes.ok) {
    throw new TodoistProxyError(
      502,
      `Todoist /sections returned ${sectionsRes.status}: ${await sectionsRes.text()}`
    );
  }

  // v1 API wraps arrays in {results: [...], next_cursor: ...}. Handle both shapes.
  const tasksJson = await tasksRes.json();
  const sectionsJson = await sectionsRes.json();
  const tasks = (Array.isArray(tasksJson) ? tasksJson : tasksJson.results ?? []) as TodoistTask[];
  const sections = (Array.isArray(sectionsJson) ? sectionsJson : sectionsJson.results ?? []) as TodoistSection[];

  const snapshot: TodoistProjectSnapshot = {
    tasks,
    sections,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
  cache.set(projectId, { data: snapshot, storedAt: Date.now() });
  return snapshot;
}
