import type { SkeinProject } from "../hooks/useProjects";

interface StatusBarProps {
  projects: SkeinProject[];
  liveState: {
    lastScan: string | null;
    activeSessions: any[];
  };
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

export function StatusBar({ projects, liveState }: StatusBarProps) {
  const activeProjects = projects.filter((p) => p.activeSessions > 0).length;
  const totalSessions = projects.reduce((sum, p) => sum + (p.totalClaudeSessions || 0), 0);
  const liveCount = liveState.activeSessions?.length ?? 0;

  return (
    <footer className="flex items-center justify-between border-t border-[var(--skein-border)] bg-[var(--skein-sidebar)] px-4 py-1.5 text-[10px] text-[var(--skein-text-muted)]">
      <div className="flex gap-4">
        <span>{projects.length} projects</span>
        <span>{totalSessions.toLocaleString()} sessions</span>
      </div>
      <div className="flex gap-4">
        {liveCount > 0 && (
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="h-1 w-1 animate-pulse rounded-full bg-emerald-400" />
            {liveCount} live across {activeProjects} projects
          </span>
        )}
        <span>Scan: {timeAgo(liveState.lastScan)} ago</span>
      </div>
    </footer>
  );
}
