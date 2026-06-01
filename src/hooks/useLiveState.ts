import { useEffect, useState } from "react";

interface ActiveSession {
  pid: number;
  tty: string;
  projectDirectory: string;
  projectName: string;
  command: string;
  startedAt: string;
  resumeId?: string;
  sessionId?: string;
}

interface LiveState {
  lastScan: string | null;
  activeSessions: ActiveSession[];
  projectSummary: Record<
    string,
    { sessionCount: number; directories: string[] }
  >;
}

export function useLiveState() {
  const [liveState, setLiveState] = useState<LiveState>({
    lastScan: null,
    activeSessions: [],
    projectSummary: {},
  });

  useEffect(() => {
    async function fetchLiveState() {
      try {
        const res = await fetch("/api/live-state");
        const data = await res.json();
        setLiveState(data);
      } catch {
        // ignore
      }
    }
    fetchLiveState();
    // Poll every 30 seconds
    const interval = setInterval(fetchLiveState, 30_000);
    return () => clearInterval(interval);
  }, []);

  return liveState;
}
