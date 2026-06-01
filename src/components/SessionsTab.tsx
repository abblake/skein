import { useEffect, useState } from "react";
import type { SkeinProject } from "../hooks/useProjects";

interface ClaudeSession {
  uuid: string;
  firstUserMessage: string;
  lastUserMessage: string;
  lastMessageAt: string;
  messageCount: number;
  userMessageCount: number;
  sizeKb: number;
}

interface SessionsTabProps {
  project: SkeinProject;
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SessionsTab({ project }: SessionsTabProps) {
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSessions([]);
    if (!project.claudeProjectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    async function fetchSessions() {
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(project.claudeProjectId)}?limit=30`
        );
        const data = await res.json();
        if (Array.isArray(data)) setSessions(data);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }
    fetchSessions();
  }, [project.claudeProjectId]);

  if (loading) {
    return <p className="text-xs text-[var(--skein-text-muted)]">Loading sessions...</p>;
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg bg-[var(--skein-panel)] p-4 text-sm text-[var(--skein-text-muted)]">
        {project.claudeProjectId
          ? "No session logs found."
          : "No Claude session logs linked to this project directory."}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="mb-3 text-xs text-[var(--skein-text-muted)]">
        {sessions.length} most recent of {project.totalClaudeSessions || sessions.length} total
      </p>
      {sessions.map((s) => (
        <div
          key={s.uuid}
          className="group flex items-start gap-3 rounded px-3 py-2 hover:bg-[var(--skein-panel)]"
        >
          {/* Time column */}
          <span className="mt-0.5 w-14 shrink-0 text-right text-[11px] tabular-nums text-[var(--skein-text-muted)]">
            {timeAgo(s.lastMessageAt)}
          </span>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="truncate text-[13px] leading-snug">
              {s.firstUserMessage || "(empty session)"}
            </p>
            {s.lastUserMessage && s.lastUserMessage !== s.firstUserMessage && (
              <p className="mt-0.5 truncate text-[11px] text-[var(--skein-text-muted)]">
                Last: {s.lastUserMessage}
              </p>
            )}
          </div>

          {/* Meta */}
          <span className="shrink-0 text-[10px] tabular-nums text-[var(--skein-text-muted)] opacity-0 group-hover:opacity-100">
            {s.userMessageCount}msg &middot; {s.sizeKb}KB
          </span>
        </div>
      ))}

      {/* Related PRDs section */}
      {project.recentPrds.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--skein-text-muted)]">
            Algorithm Sessions
          </h3>
          {project.recentPrds.map((prd) => (
            <div key={prd.slug} className="flex items-center gap-3 rounded px-3 py-2 hover:bg-[var(--skein-panel)]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  prd.phase === "complete" ? "bg-emerald-400" : "bg-[var(--skein-amber)]"
                }`}
              />
              <span className="flex-1 truncate text-[13px]">{prd.task}</span>
              <span className="text-[10px] tabular-nums text-[var(--skein-text-muted)]">{prd.progress}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
