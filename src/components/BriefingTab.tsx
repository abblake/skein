import { useEffect, useState } from "react";
import type { SkeinProject } from "../hooks/useProjects";

interface BriefingTabProps {
  project: SkeinProject;
  liveState: any;
}

interface ProjectBriefing {
  whereYouLeftOff: string;
  keyTopics: string[];
  recentActivity: string[];
  openQuestions: string[];
  generatedAt: string;
  sessionCount: number;
}

export function BriefingTab({ project, liveState }: BriefingTabProps) {
  const [briefing, setBriefing] = useState<ProjectBriefing | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const canGenerate = !!project.claudeProjectId;

  // Load cached briefing
  useEffect(() => {
    setBriefing(null);
    setLoaded(false);
    if (!project.claudeProjectId) { setLoaded(true); return; }

    async function load() {
      try {
        const res = await fetch(`/api/project-briefing/${encodeURIComponent(project.claudeProjectId)}`);
        const data = await res.json();
        if (data?.whereYouLeftOff) setBriefing(data);
      } catch { /* no cached briefing */ }
      finally { setLoaded(true); }
    }
    load();
  }, [project.claudeProjectId]);

  async function handleGenerate() {
    if (!canGenerate) return;
    setGenerating(true);
    try {
      const res = await fetch(
        `/api/project-briefing/${encodeURIComponent(project.claudeProjectId)}?name=${encodeURIComponent(project.name)}`,
        { method: "POST" }
      );
      const data = await res.json();
      if (data?.whereYouLeftOff) setBriefing(data);
      else if (data?.error) alert(`Failed: ${data.error}`);
    } catch (err: any) { alert(err.message); }
    finally { setGenerating(false); }
  }

  const liveSessions = liveState?.activeSessions?.filter(
    (s: any) => s.projectName === project.name
  ) ?? [];

  if (!loaded) return <p className="text-xs text-[var(--skein-text-muted)]">Loading...</p>;

  const enrichment = project.enrichment;

  return (
    <div className="space-y-5">
      {/* Directory + enrichment header */}
      <div className="rounded-lg border border-[var(--skein-border)] bg-[var(--skein-panel)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--skein-text-muted)]">
              Directory
            </p>
            <code
              className="block truncate font-mono text-[12px] text-[var(--skein-text)]"
              title={project.directory}
            >
              {project.relativeDir || project.directory}
            </code>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-[10px]">
            {enrichment?.git && (
              <span
                className={`rounded px-1.5 py-0.5 font-mono ${
                  enrichment.git.dirty
                    ? "bg-amber-950/50 text-amber-400"
                    : "bg-emerald-950/50 text-emerald-400"
                }`}
              >
                {enrichment.git.branch || "detached"}
                {enrichment.git.dirty ? " ●" : ""}
              </span>
            )}
            {enrichment?.stats && enrichment.stats.fileCount > 0 && (
              <span className="text-[var(--skein-text-muted)]">
                {enrichment.stats.fileCount} files
                {enrichment.stats.lastModified
                  ? ` · ${new Date(enrichment.stats.lastModified).toLocaleDateString()}`
                  : ""}
              </span>
            )}
          </div>
        </div>
        {enrichment?.git?.lastCommit && (
          <p className="mt-2 text-[11px] text-[var(--skein-text-muted)]">
            Last commit:{" "}
            <span className="text-[var(--skein-text)]">
              {enrichment.git.lastCommit}
            </span>
            {enrichment.git.lastCommitDate && (
              <span className="ml-1">
                · {new Date(enrichment.git.lastCommitDate).toLocaleDateString()}
              </span>
            )}
          </p>
        )}
        {enrichment?.telosProject && (
          <p className="mt-1 text-[11px]">
            <span className="text-[var(--skein-text-muted)]">Telos: </span>
            <span className="text-[var(--skein-accent)]">
              {enrichment.telosProject.name}
            </span>
            {enrichment.adhdPlanCount > 0 && (
              <span className="ml-2 rounded bg-[var(--skein-accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--skein-accent)]">
                {enrichment.adhdPlanCount} /adhd-plan run
                {enrichment.adhdPlanCount === 1 ? "" : "s"}
              </span>
            )}
          </p>
        )}
        {enrichment?.readmePreview && (
          <p className="mt-3 border-t border-[var(--skein-border)] pt-3 text-[12px] leading-relaxed text-[var(--skein-text-muted)]">
            {enrichment.readmePreview}
          </p>
        )}
      </div>

      {/* Live session banner */}
      {liveSessions.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-900/30 bg-emerald-950/40 px-4 py-3">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-sm text-emerald-300">
            {liveSessions.length} session{liveSessions.length > 1 ? "s" : ""} running
          </span>
          <span className="ml-auto text-[10px] text-emerald-500">
            {liveSessions.map((s: any) => s.tty).join(", ")}
          </span>
        </div>
      )}

      {/* AI Briefing — the hero section */}
      {briefing ? (
        <>
          {/* Where you left off — the #1 most important block */}
          <div className="rounded-lg border border-[var(--skein-accent)]/20 bg-[var(--skein-panel)] p-5">
            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--skein-accent)]">
              Where You Left Off
            </h3>
            <p className="text-[15px] leading-relaxed">{briefing.whereYouLeftOff}</p>
          </div>

          {/* Two-column: Topics + Recent Activity */}
          <div className="grid grid-cols-2 gap-4">
            {briefing.keyTopics.length > 0 && (
              <div className="rounded-lg bg-[var(--skein-panel)] p-4">
                <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--skein-text-muted)]">
                  Key Topics
                </h3>
                {briefing.keyTopics.map((t, i) => (
                  <p key={i} className="py-0.5 text-[13px]">{t}</p>
                ))}
              </div>
            )}
            {briefing.recentActivity.length > 0 && (
              <div className="rounded-lg bg-[var(--skein-panel)] p-4">
                <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--skein-text-muted)]">
                  Recent Activity
                </h3>
                {briefing.recentActivity.map((a, i) => (
                  <p key={i} className="py-0.5 text-[13px] text-[var(--skein-text-muted)]">{a}</p>
                ))}
              </div>
            )}
          </div>

          {/* Open questions */}
          {briefing.openQuestions.length > 0 && (
            <div>
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--skein-amber)]">
                Open Questions
              </h3>
              {briefing.openQuestions.map((q, i) => (
                <div key={i} className="flex items-start gap-2 py-1">
                  <span className="mt-0.5 font-bold text-[var(--skein-accent)]">?</span>
                  <span className="text-[13px]">{q}</span>
                </div>
              ))}
            </div>
          )}

          {/* Meta */}
          <p className="text-[10px] text-[var(--skein-text-muted)]">
            Briefing from {briefing.sessionCount} sessions &middot; Generated{" "}
            {new Date(briefing.generatedAt).toLocaleString()}
            <button onClick={handleGenerate} disabled={generating} className="ml-2 text-[var(--skein-accent)] hover:underline">
              {generating ? "..." : "Refresh"}
            </button>
          </p>
        </>
      ) : (
        /* No briefing yet — show what we have + prominent generate button */
        <>
          {project.recentSessionPreviews?.[0]?.firstUserMessage && (
            <div className="rounded-lg bg-[var(--skein-panel)] p-5">
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[var(--skein-text-muted)]">
                Most Recent Session
              </h3>
              <p className="text-[14px] leading-relaxed">
                {project.recentSessionPreviews[0].firstUserMessage}
              </p>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded bg-[var(--skein-panel)] p-3 text-center">
              <p className="text-xl font-bold tabular-nums">{project.totalClaudeSessions || 0}</p>
              <p className="text-[10px] uppercase text-[var(--skein-text-muted)]">Sessions</p>
            </div>
            <div className="rounded bg-[var(--skein-panel)] p-3 text-center">
              <p className="text-xl font-bold tabular-nums">{project.prdCount || 0}</p>
              <p className="text-[10px] uppercase text-[var(--skein-text-muted)]">PRDs</p>
            </div>
            <div className="rounded bg-[var(--skein-panel)] p-3 text-center">
              <p className="text-xl font-bold tabular-nums">{project.activeSessions}</p>
              <p className="text-[10px] uppercase text-[var(--skein-text-muted)]">Live</p>
            </div>
          </div>

          {/* Generate button — prominent */}
          {canGenerate && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full rounded-lg border border-[var(--skein-accent)]/30 bg-[var(--skein-accent)]/10 py-3.5 text-sm font-medium text-[var(--skein-accent)] hover:bg-[var(--skein-accent)]/20 disabled:opacity-50"
            >
              {generating
                ? "Reading sessions and generating briefing..."
                : `Generate AI Briefing from ${project.totalClaudeSessions || "?"} sessions`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
