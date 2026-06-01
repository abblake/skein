import type { Tab } from "../App";
import type { SkeinProject } from "../hooks/useProjects";
import { BriefingTab } from "./BriefingTab";
import { SessionsTab } from "./SessionsTab";
import { ThreadsTab } from "./ThreadsTab";
import { NarrativeTab } from "./NarrativeTab";
import { PlansTab } from "./PlansTab";

interface ContextPanelProps {
  project: SkeinProject | null;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  liveState: any;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "briefing", label: "Briefing" },
  { id: "sessions", label: "Sessions" },
  { id: "threads", label: "Threads" },
  { id: "narrative", label: "Narrative" },
  { id: "plans", label: "Plans" },
];

export function ContextPanel({
  project,
  activeTab,
  onTabChange,
  liveState,
}: ContextPanelProps) {
  if (!project) {
    return (
      <main className="flex flex-1 items-center justify-center bg-[var(--skein-bg)]">
        <div className="max-w-sm text-center">
          <p className="text-base text-[var(--skein-text-muted)]">
            Select a project
          </p>
          <p className="mt-1 text-xs text-[var(--skein-text-muted)]/60">
            Pick a project from the sidebar to see your session history,
            open threads, and research narrative
          </p>
        </div>
      </main>
    );
  }

  // Count live sessions for this project
  const liveSessions = liveState?.activeSessions?.filter(
    (s: any) => s.projectName === project.name
  ) ?? [];

  return (
    <main className="flex flex-1 flex-col bg-[var(--skein-bg)]">
      {/* Project header */}
      <div className="border-b border-[var(--skein-border)] px-6 py-3">
        <div className="flex items-center gap-3">
          {liveSessions.length > 0 && (
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          )}
          <h2 className="text-base font-semibold">{project.name}</h2>
          <span className="text-xs text-[var(--skein-text-muted)]">
            {project.totalClaudeSessions || project.prdCount || 0} sessions
          </span>
          {liveSessions.length > 0 && (
            <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
              {liveSessions.length} live
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--skein-border)] px-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`mr-1 px-3 py-2.5 text-[13px] font-medium transition-colors ${
              activeTab === tab.id
                ? "border-b-2 border-[var(--skein-accent)] text-[var(--skein-accent)]"
                : "text-[var(--skein-text-muted)] hover:text-[var(--skein-text)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "briefing" && (
          <BriefingTab project={project} liveState={liveState} />
        )}
        {activeTab === "sessions" && (
          <SessionsTab project={project} />
        )}
        {activeTab === "threads" && (
          <ThreadsTab project={project} />
        )}
        {activeTab === "narrative" && (
          <NarrativeTab project={project} />
        )}
        {activeTab === "plans" && (
          <PlansTab project={project} />
        )}
      </div>
    </main>
  );
}
