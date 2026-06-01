import { useEffect, useState } from "react";

export interface TitleEntry {
  title: string;
  generatedAt: string;
}
export type TitleMap = Record<string, TitleEntry>;

/** Polls the Haiku-generated session titles (#32), keyed by sessionId. */
export function useSessionTitles() {
  const [titles, setTitles] = useState<TitleMap>({});

  useEffect(() => {
    let cancelled = false;
    async function fetchTitles() {
      try {
        const res = await fetch("/api/session-titles");
        const data = await res.json();
        if (!cancelled) setTitles(data ?? {});
      } catch {
        // ignore
      }
    }
    fetchTitles();
    const interval = setInterval(fetchTitles, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return titles;
}
