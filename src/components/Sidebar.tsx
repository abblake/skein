import { useState } from "react";
import type { SkeinProject } from "../hooks/useProjects";

interface SidebarProps {
  projects: SkeinProject[];
  loading: boolean;
  selectedProject: SkeinProject | null;
  onSelectProject: (project: SkeinProject) => void;
}

type GroupKey = "active" | "recent" | "stale";

function groupProjects(projects: SkeinProject[]): Record<GroupKey, SkeinProject[]> {
  const now = Date.now();
  const dayMs = 86400000;
  const groups: Record<GroupKey, SkeinProject[]> = { active: [], recent: [], stale: [] };

  for (const p of projects) {
    if (p.activeSessions > 0) {
      groups.active.push(p);
    } else if (p.lastActivity && now - new Date(p.lastActivity).getTime() < 7 * dayMs) {
      groups.recent.push(p);
    } else {
      groups.stale.push(p);
    }
  }

  return groups;
}

const GROUP_LABELS: Record<GroupKey, { label: string; color: string }> = {
  active: { label: "Active Now", color: "text-emerald-400" },
  recent: { label: "Recent", color: "text-[var(--skein-accent)]" },
  stale: { label: "Older", color: "text-[var(--skein-text-muted)]" },
};

export function Sidebar({
  projects,
  loading,
  selectedProject,
  onSelectProject,
}: SidebarProps) {
  const [filter, setFilter] = useState("");
  const [showStale, setShowStale] = useState(false);

  const filtered = projects.filter((p) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.directory.toLowerCase().includes(q) ||
      p.relativeDir.toLowerCase().includes(q)
    );
  });

  const groups = groupProjects(filtered);
  const activeCount = groups.active.length;

  return (
    <aside className="flex w-64 flex-col border-r border-[var(--skein-border)] bg-[var(--skein-sidebar)]">
      {/* Header */}
      <div className="border-b border-[var(--skein-border)] px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold tracking-tight">Skein</h1>
          {activeCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-950 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {activeCount}
            </span>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <input
          type="text"
          placeholder="Find project..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded bg-[var(--skein-bg)] px-2.5 py-1.5 text-xs text-[var(--skein-text)] placeholder-[var(--skein-text-muted)]/50 outline-none focus:ring-1 focus:ring-[var(--skein-accent)]/50"
        />
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <p className="px-2 py-8 text-center text-xs text-[var(--skein-text-muted)]">
            Scanning projects...
          </p>
        ) : (
          (["active", "recent", "stale"] as GroupKey[]).map((key) => {
            const items = groups[key];
            if (items.length === 0) return null;
            if (key === "stale" && !showStale && !filter) {
              return (
                <div key={key} className="mt-3">
                  <button
                    onClick={() => setShowStale(true)}
                    className="w-full px-2 py-1 text-left text-[10px] text-[var(--skein-text-muted)] hover:text-[var(--skein-text)]"
                  >
                    + {items.length} older projects
                  </button>
                </div>
              );
            }

            return (
              <div key={key} className="mt-3 first:mt-0">
                <p className={`mb-1 px-2 text-[10px] font-bold uppercase tracking-widest ${GROUP_LABELS[key].color}`}>
                  {GROUP_LABELS[key].label}
                </p>
                {items.map((project) => {
                  const isSelected = selectedProject?.id === project.id;
                  const isActive = project.activeSessions > 0;
                  const sessionCount = project.totalClaudeSessions || project.prdCount || 0;
                  const planCount = project.enrichment?.adhdPlanCount ?? 0;
                  const gitDirty = project.enrichment?.git?.dirty ?? false;

                  return (
                    <button
                      key={project.id}
                      onClick={() => onSelectProject(project)}
                      title={project.directory}
                      className={`mb-0.5 flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                        isSelected
                          ? "bg-[var(--skein-accent)]/15 text-[var(--skein-accent)]"
                          : "text-[var(--skein-text)] hover:bg-[var(--skein-panel)]"
                      }`}
                    >
                      <span
                        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                          isActive
                            ? "animate-pulse bg-emerald-400"
                            : key === "recent"
                              ? "bg-[var(--skein-accent)]/60"
                              : "bg-[var(--skein-text-muted)]/30"
                        }`}
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span
                          dir="rtl"
                          className="truncate text-left font-mono text-[11px] leading-tight"
                        >
                          {project.relativeDir || project.directory}
                        </span>
                        <span className="flex items-center gap-1 truncate text-[10px] text-[var(--skein-text-muted)]">
                          <span className="truncate">{project.name}</span>
                          {gitDirty && (
                            <span
                              title="Uncommitted changes"
                              className="shrink-0 rounded bg-amber-950/50 px-1 text-[9px] font-semibold text-amber-400"
                            >
                              ●
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        {sessionCount > 0 && (
                          <span className="text-[10px] tabular-nums text-[var(--skein-text-muted)]">
                            {sessionCount}
                          </span>
                        )}
                        {planCount > 0 && (
                          <span
                            title={`${planCount} /adhd-plan run${planCount === 1 ? "" : "s"}`}
                            className="rounded bg-[var(--skein-accent)]/15 px-1 text-[9px] font-semibold text-[var(--skein-accent)]"
                          >
                            {planCount}p
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--skein-border)] px-3 py-2 text-[10px] text-[var(--skein-text-muted)]">
        {projects.length} projects
      </div>
    </aside>
  );
}
