import { useEffect, useState } from "react";

export type Column = "live" | "parked" | "waiting" | "done";

export interface ThreadCard {
  id: string;
  uuid: string;
  title: string;
  projectId: string;
  projectDir: string;
  column: Column;
  filed: boolean;
  live: boolean;
  status?: string;
  pid?: number;
  tty?: string;
  lastActiveAt: string;
  stale: boolean;
  firstSeenAt: string;
  digest?: string;
  digestAt?: string;
  goalId?: string;
  goalLabel?: string;
  recurring?: boolean;
}

export interface ThreadStore {
  lastScan: string | null;
  cards: ThreadCard[];
}

/** Poll the parking lot every 10s — fast enough that Live→Parked feels honest. */
export function useThreads() {
  const [store, setStore] = useState<ThreadStore>({ lastScan: null, cards: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchThreads() {
      try {
        const res = await fetch("/api/threads");
        const data = await res.json();
        if (!cancelled) setStore(data);
      } catch {
        // ignore — keep last good state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchThreads();
    const interval = setInterval(fetchThreads, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { store, loading };
}
