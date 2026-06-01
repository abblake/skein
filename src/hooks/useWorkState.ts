import { useEffect, useState } from "react";

interface PrdListItem {
  slug: string;
  task?: string;
  phase?: string;
  progress?: string;
  effort?: string;
  started?: string;
  updated?: string;
  mtime?: number;
}

export function useWorkSessions() {
  const [sessions, setSessions] = useState<PrdListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSessions() {
      try {
        const res = await fetch("/api/prds");
        const data: PrdListItem[] = await res.json();
        setSessions(data);
      } catch (err) {
        console.error("Failed to fetch PRDs:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchSessions();
    // Poll every 10 seconds for live updates
    const interval = setInterval(fetchSessions, 10_000);
    return () => clearInterval(interval);
  }, []);

  return { sessions, loading };
}
