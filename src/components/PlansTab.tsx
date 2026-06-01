import { useEffect, useState } from "react";
import type { SkeinProject } from "../hooks/useProjects";
import { PlanMarkdown } from "./PlanMarkdown";

interface PlansTabProps {
  project: SkeinProject;
}

interface ProjectLinkSession {
  uuid: string;
  slug: string;
  planPath: string;
  date: string;
  todoistProjectId?: string;
  todoistTaskCount?: number;
}

interface ProjectLinkEntry {
  telosSlug: string;
  todoistProjectId?: string;
  sessions: ProjectLinkSession[];
  updatedAt: string;
}

type ProjectLinks = Record<string, ProjectLinkEntry>;

interface EnrichedLink {
  project: string;
  entry: ProjectLinkEntry;
  telosBlock: string;
  workingDir: string;
  latestSession: ProjectLinkSession | null;
  latestPlan: string;
}

interface TodoistTask {
  id: string;
  project_id: string;
  section_id: string | null;
  content: string;
  description: string;
  labels: string[];
  priority: number;
  checked: boolean;
}

interface TodoistSection {
  id: string;
  project_id: string;
  name: string;
  order: number;
}

interface TodoistSnapshot {
  tasks: TodoistTask[];
  sections: TodoistSection[];
  fetchedAt: string;
  cached: boolean;
}

/** Todoist priority: 4=urgent (P1), 3=high (P2), 2=medium (P3), 1=normal (P4/none). */
function priorityClass(priority: number): string {
  if (priority === 4) return "bg-red-500";
  if (priority === 3) return "bg-orange-500";
  if (priority === 2) return "bg-blue-500";
  return "bg-[var(--skein-text-muted)]/30";
}

function priorityLabel(priority: number): string {
  if (priority === 4) return "P1";
  if (priority === 3) return "P2";
  if (priority === 2) return "P3";
  return "";
}

/** Fuzzy match: pick the research-project whose name best overlaps the SkeinProject name. */
function bestMatch(skeinName: string, keys: string[]): string | null {
  if (keys.length === 0) return null;
  const tokens = skeinName
    .toLowerCase()
    .split(/[\s_\-/\\.]+/)
    .filter((t) => t.length > 2);
  let best: { key: string; score: number } | null = null;
  for (const key of keys) {
    const kLower = key.toLowerCase();
    const score = tokens.reduce((acc, t) => (kLower.includes(t) ? acc + 1 : acc), 0);
    if (!best || score > best.score) best = { key, score };
  }
  return best && best.score > 0 ? best.key : null;
}

export function PlansTab({ project }: PlansTabProps) {
  const [links, setLinks] = useState<ProjectLinks>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [enriched, setEnriched] = useState<EnrichedLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [todoist, setTodoist] = useState<TodoistSnapshot | null>(null);
  const [todoistError, setTodoistError] = useState<string>("");
  const [todoistLoading, setTodoistLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/project-links");
        const data = (await res.json()) as ProjectLinks;
        if (!cancelled) {
          setLinks(data);
          const keys = Object.keys(data);
          // Prefer exact Telos match from server-side enrichment; fall back to fuzzy name match
          const exactName = project.enrichment?.telosProject?.name;
          const exact = exactName && keys.includes(exactName) ? exactName : null;
          const preferred = exact ?? bestMatch(project.name, keys) ?? keys[0] ?? null;
          setSelected(preferred);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.name, project.enrichment?.telosProject?.name]);

  useEffect(() => {
    if (!selected) {
      setEnriched(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/project-links/${encodeURIComponent(selected)}`
        );
        if (!res.ok) {
          if (!cancelled) setEnriched(null);
          return;
        }
        const data = (await res.json()) as EnrichedLink;
        if (!cancelled) setEnriched(data);
      } catch {
        if (!cancelled) setEnriched(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function loadTodoist(projectId: string, bypassCache = false) {
    setTodoistLoading(true);
    setTodoistError("");
    try {
      const url = `/api/todoist/project/${encodeURIComponent(projectId)}${bypassCache ? "?refresh=1" : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        setTodoistError(data?.error ?? `HTTP ${res.status}`);
        setTodoist(null);
      } else {
        setTodoist(data as TodoistSnapshot);
      }
    } catch (err) {
      setTodoistError(err instanceof Error ? err.message : "fetch failed");
      setTodoist(null);
    } finally {
      setTodoistLoading(false);
    }
  }

  useEffect(() => {
    setTodoist(null);
    setTodoistError("");
    const pid = enriched?.entry?.todoistProjectId;
    if (pid) {
      loadTodoist(pid);
    }
  }, [enriched?.entry?.todoistProjectId]);

  if (loading) {
    return (
      <p className="text-xs text-[var(--skein-text-muted)]">Loading plans…</p>
    );
  }

  const keys = Object.keys(links);
  if (keys.length === 0) {
    return (
      <div className="max-w-md">
        <p className="text-sm text-[var(--skein-text-muted)]">
          No /adhd-plan runs linked yet.
        </p>
        <p className="mt-2 text-xs text-[var(--skein-text-muted)]/70">
          Run <code className="rounded bg-[var(--skein-panel)] px-1 py-0.5">/adhd-plan</code> in Claude Code, pick a research-project when prompted, and the plan will appear here with its Todoist task count and session ID.
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      {/* Research-project selector */}
      <div className="w-56 shrink-0">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--skein-text-muted)]">
          Research projects
        </p>
        <div className="space-y-0.5">
          {keys.map((key) => {
            const entry = links[key];
            const isSelected = key === selected;
            return (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className={`block w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  isSelected
                    ? "bg-[var(--skein-accent)]/15 text-[var(--skein-accent)]"
                    : "text-[var(--skein-text)] hover:bg-[var(--skein-panel)]"
                }`}
              >
                <span className="block truncate font-medium">{key}</span>
                <span className="text-[10px] text-[var(--skein-text-muted)]">
                  {entry.sessions.length} session{entry.sessions.length === 1 ? "" : "s"}
                  {entry.todoistProjectId ? " · todoist linked" : ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail */}
      <div className="min-w-0 flex-1 space-y-4">
        {!enriched && selected && (
          <p className="text-xs text-[var(--skein-text-muted)]">
            Loading {selected}…
          </p>
        )}
        {enriched && (
          <>
            {/* Telos block */}
            <section className="rounded border border-[var(--skein-border)] bg-[var(--skein-panel)] p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--skein-accent)]">
                  Telos status
                </p>
                {enriched.workingDir && (
                  <code
                    className="truncate rounded bg-[var(--skein-bg)] px-1.5 py-0.5 text-[10px] text-[var(--skein-text-muted)]"
                    title={enriched.workingDir}
                  >
                    📁 {enriched.workingDir}
                  </code>
                )}
              </div>
              {enriched.telosBlock ? (
                <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--skein-text)]">
                  {enriched.telosBlock}
                </pre>
              ) : (
                <p className="text-xs italic text-[var(--skein-text-muted)]">
                  No Telos entry for this project.
                </p>
              )}
            </section>

            {/* Sessions + Todoist */}
            <section className="rounded border border-[var(--skein-border)] bg-[var(--skein-panel)] p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--skein-accent)]">
                Sessions · {enriched.entry.sessions.length}
                {enriched.entry.todoistProjectId
                  ? ` · Todoist: ${enriched.entry.todoistProjectId}`
                  : ""}
              </p>
              <div className="space-y-1">
                {[...enriched.entry.sessions]
                  .sort(
                    (a, b) =>
                      new Date(b.date).getTime() - new Date(a.date).getTime()
                  )
                  .map((s) => (
                    <div
                      key={s.uuid}
                      className="flex items-center gap-2 text-[11px]"
                    >
                      <span className="font-mono text-[var(--skein-text-muted)]">
                        {s.uuid.slice(0, 8)}
                      </span>
                      <span className="truncate text-[var(--skein-text)]">
                        {s.slug}
                      </span>
                      {typeof s.todoistTaskCount === "number" && (
                        <span className="rounded bg-[var(--skein-bg)] px-1.5 py-0.5 text-[10px] text-[var(--skein-text-muted)]">
                          {s.todoistTaskCount} tasks
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-[var(--skein-text-muted)]">
                        {new Date(s.date).toLocaleString()}
                      </span>
                    </div>
                  ))}
              </div>
            </section>

            {/* Live Todoist tasks */}
            {enriched.entry.todoistProjectId && (
              <section className="rounded border border-[var(--skein-border)] bg-[var(--skein-panel)] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--skein-accent)]">
                    Todoist tasks
                    {todoist && (
                      <span className="ml-2 font-normal text-[var(--skein-text-muted)]">
                        · {todoist.tasks.length} task{todoist.tasks.length === 1 ? "" : "s"}
                        {todoist.cached ? " · cached" : ""}
                      </span>
                    )}
                  </p>
                  <button
                    onClick={() =>
                      enriched.entry.todoistProjectId &&
                      loadTodoist(enriched.entry.todoistProjectId, true)
                    }
                    disabled={todoistLoading}
                    className="rounded bg-[var(--skein-bg)] px-2 py-0.5 text-[10px] text-[var(--skein-text-muted)] hover:text-[var(--skein-accent)] disabled:opacity-50"
                  >
                    {todoistLoading ? "..." : "↻ Refresh"}
                  </button>
                </div>

                {todoistError && (
                  <p className="text-[11px] italic text-red-400">
                    {todoistError}
                  </p>
                )}

                {!todoist && !todoistError && todoistLoading && (
                  <p className="text-[11px] italic text-[var(--skein-text-muted)]">
                    Loading tasks…
                  </p>
                )}

                {todoist && todoist.tasks.length === 0 && (
                  <p className="text-[11px] italic text-[var(--skein-text-muted)]">
                    No tasks in this Todoist project.
                  </p>
                )}

                {todoist && todoist.tasks.length > 0 && (
                  <div className="space-y-3">
                    {(() => {
                      const sectionMap = new Map<string, string>();
                      for (const s of todoist.sections) sectionMap.set(s.id, s.name);
                      const grouped = new Map<string, TodoistTask[]>();
                      for (const t of todoist.tasks) {
                        const key = t.section_id ?? "__no_section__";
                        if (!grouped.has(key)) grouped.set(key, []);
                        grouped.get(key)!.push(t);
                      }
                      const ordered = [...todoist.sections]
                        .sort((a, b) => a.order - b.order)
                        .map((s) => s.id);
                      if (grouped.has("__no_section__")) ordered.push("__no_section__");
                      return ordered
                        .filter((k) => grouped.has(k))
                        .map((key) => {
                          const tasks = grouped.get(key) ?? [];
                          const title =
                            key === "__no_section__"
                              ? "No section"
                              : sectionMap.get(key) ?? "Unknown section";
                          return (
                            <div key={key}>
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--skein-text-muted)]">
                                {title}
                              </p>
                              <div className="space-y-1">
                                {tasks.map((t) => {
                                  const pLabel = priorityLabel(t.priority);
                                  return (
                                    <div
                                      key={t.id}
                                      className={`flex items-start gap-2 rounded px-2 py-1 text-[11px] ${
                                        t.checked
                                          ? "opacity-50 line-through"
                                          : ""
                                      }`}
                                    >
                                      <span
                                        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${priorityClass(t.priority)}`}
                                        title={pLabel || "no priority"}
                                      />
                                      <span className="flex-1 break-words text-[var(--skein-text)]">
                                        {t.content}
                                      </span>
                                      <span className="flex shrink-0 flex-wrap items-center gap-1">
                                        {t.labels.map((l) => (
                                          <span
                                            key={l}
                                            className="rounded bg-[var(--skein-bg)] px-1 py-0.5 text-[9px] text-[var(--skein-text-muted)]"
                                          >
                                            @{l}
                                          </span>
                                        ))}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        });
                    })()}
                  </div>
                )}
              </section>
            )}

            {/* Latest plan markdown */}
            <section className="rounded border border-[var(--skein-border)] bg-[var(--skein-panel)] p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--skein-accent)]">
                Latest plan
                {enriched.latestSession
                  ? ` · ${new Date(enriched.latestSession.date).toLocaleDateString()}`
                  : ""}
              </p>
              {enriched.latestPlan ? (
                <PlanMarkdown source={enriched.latestPlan} />
              ) : (
                <p className="text-xs italic text-[var(--skein-text-muted)]">
                  No plan markdown available.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
