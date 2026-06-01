import { useEffect, useState } from "react";
import type { SkeinProject } from "../hooks/useProjects";

interface ThreadsTabProps {
  project: SkeinProject;
}

interface Thread {
  id: string;
  type: "question" | "hypothesis" | "todo";
  text: string;
  sourceDate: string;
  status: "open" | "resolved" | "stale";
}

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

const ICONS: Record<string, string> = { question: "?", hypothesis: "\u25B6", todo: "!" };
const COLORS: Record<string, string> = {
  question: "text-[var(--skein-accent)] bg-[var(--skein-accent)]/10",
  hypothesis: "text-emerald-400 bg-emerald-400/10",
  todo: "text-[var(--skein-amber)] bg-[var(--skein-amber)]/10",
};

export function ThreadsTab({ project }: ThreadsTabProps) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    async function fetchThreads() {
      // Try threads from each related PRD
      const allThreads: Thread[] = [];
      for (const prd of project.recentPrds.slice(0, 5)) {
        try {
          const res = await fetch(`/api/threads/${prd.slug}`);
          const data = await res.json();
          if (Array.isArray(data)) allThreads.push(...data);
        } catch { /* ignore */ }
      }
      // Deduplicate by text
      const seen = new Set<string>();
      const unique = allThreads.filter((t) => {
        if (seen.has(t.text)) return false;
        seen.add(t.text);
        return true;
      });
      setThreads(unique);
      setLoading(false);
    }
    fetchThreads();
  }, [project.id]);

  if (loading) return <p className="text-xs text-[var(--skein-text-muted)]">Loading...</p>;

  const open = threads.filter((t) => t.status === "open");
  const stale = threads.filter((t) => t.status === "stale");

  if (threads.length === 0) {
    return (
      <div className="rounded-lg bg-[var(--skein-panel)] p-5 text-center">
        <p className="text-sm text-[var(--skein-text-muted)]">No open threads</p>
        <p className="mt-1 text-xs text-[var(--skein-text-muted)]/60">
          Generate session digests to extract questions, hypotheses, and TODOs
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {open.length > 0 && (
        <p className="mb-2 text-xs text-[var(--skein-text-muted)]">{open.length} open</p>
      )}
      {open.map((t) => (
        <div key={t.id} className="flex items-start gap-2.5 rounded px-3 py-2 hover:bg-[var(--skein-panel)]">
          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${COLORS[t.type]}`}>
            {ICONS[t.type]}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] leading-snug">{t.text}</p>
            <p className="mt-0.5 text-[10px] text-[var(--skein-text-muted)]">{daysAgo(t.sourceDate)}d ago</p>
          </div>
        </div>
      ))}

      {stale.length > 0 && (
        <>
          <p className="mt-4 mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--skein-red)]">
            Stale ({stale.length})
          </p>
          {stale.map((t) => (
            <div key={t.id} className="flex items-start gap-2.5 rounded px-3 py-2 opacity-50 hover:bg-[var(--skein-panel)] hover:opacity-80">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${COLORS[t.type]}`}>
                {ICONS[t.type]}
              </span>
              <p className="text-[13px] leading-snug">{t.text}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
