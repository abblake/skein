import { useEffect, useState } from "react";
import type { SkeinProject } from "../hooks/useProjects";

interface NarrativeTabProps {
  project: SkeinProject;
}

export function NarrativeTab({ project }: NarrativeTabProps) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const canGenerate = !!project.claudeProjectId;

  useEffect(() => {
    setNarrative(null);
    setLoading(true);
    if (!project.claudeProjectId) { setLoading(false); return; }

    async function load() {
      try {
        const res = await fetch(`/api/project-narrative/${encodeURIComponent(project.claudeProjectId)}`);
        const data = await res.json();
        if (data?.narrative) setNarrative(data.narrative);
      } catch { /* no narrative */ }
      finally { setLoading(false); }
    }
    load();
  }, [project.claudeProjectId]);

  async function handleGenerate() {
    if (!canGenerate) return;
    setGenerating(true);
    try {
      const res = await fetch(
        `/api/project-narrative/${encodeURIComponent(project.claudeProjectId)}?name=${encodeURIComponent(project.name)}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (data?.narrative) setNarrative(data.narrative);
      else if (data?.error) alert(`Failed: ${data.error}`);
    } catch (err: any) { alert(err.message); }
    finally { setGenerating(false); }
  }

  if (loading) return <p className="text-xs text-[var(--skein-text-muted)]">Loading...</p>;

  return (
    <div>
      {narrative ? (
        <>
          <div className="rounded-lg bg-[var(--skein-panel)] p-6 text-[14px] leading-relaxed whitespace-pre-wrap">
            {narrative}
          </div>
          {canGenerate && (
            <p className="mt-3 text-right text-[10px] text-[var(--skein-text-muted)]">
              <button onClick={handleGenerate} disabled={generating} className="text-[var(--skein-accent)] hover:underline">
                {generating ? "Updating..." : "Update narrative"}
              </button>
            </p>
          )}
        </>
      ) : (
        <div className="rounded-lg bg-[var(--skein-panel)] p-6 text-center">
          <p className="text-sm text-[var(--skein-text-muted)]">No narrative yet</p>
          <p className="mt-1 text-xs text-[var(--skein-text-muted)]/60">
            The narrative synthesizes your {project.totalClaudeSessions || 0} sessions into a coherent research story
          </p>
          {canGenerate && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="mt-4 rounded-lg border border-[var(--skein-accent)]/30 bg-[var(--skein-accent)]/10 px-5 py-2.5 text-sm text-[var(--skein-accent)] hover:bg-[var(--skein-accent)]/20 disabled:opacity-50"
            >
              {generating
                ? "Reading sessions and synthesizing..."
                : `Generate Narrative from ${project.totalClaudeSessions || "?"} sessions`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
