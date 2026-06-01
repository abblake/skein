import { useEffect, useState } from "react";

export interface TelosMatch {
  name: string;
  workingDir: string;
  block: string;
}

export interface GitInfo {
  branch: string;
  dirty: boolean;
  lastCommit: string;
  lastCommitDate: string;
}

export interface FsStats {
  fileCount: number;
  lastModified: string;
}

export interface Enrichment {
  telosProject: TelosMatch | null;
  adhdPlanCount: number;
  git: GitInfo | null;
  readmePreview: string;
  stats: FsStats | null;
}

export interface SkeinProject {
  id: string;
  name: string;
  directory: string;
  relativeDir: string;
  activeSessions: number;
  activeSessionDetails: Array<{
    pid: number;
    tty: string;
    startedAt: string;
    command: string;
  }>;
  prdCount: number;
  recentPrds: Array<{
    slug: string;
    task: string;
    phase: string;
    progress: string;
    updated: string;
  }>;
  totalClaudeSessions: number;
  claudeProjectId: string;
  recentSessionPreviews: Array<{
    uuid: string;
    firstUserMessage: string;
    lastMessageAt: string;
  }>;
  lastActivity: string;
  hasClaudeConfig: boolean;
  enrichment: Enrichment;
}

export function useProjects() {
  const [projects, setProjects] = useState<SkeinProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch_() {
      try {
        const res = await fetch("/api/projects/scan");
        const data = await res.json();
        if (Array.isArray(data)) setProjects(data);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    fetch_();
    // Refresh every 30 seconds
    const interval = setInterval(fetch_, 30_000);
    return () => clearInterval(interval);
  }, []);

  return { projects, loading };
}
