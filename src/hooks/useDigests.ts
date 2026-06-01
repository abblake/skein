import { useEffect, useState } from "react";

export interface Digest {
  slug: string;
  file: string;
  session_slug?: string;
  task?: string;
  timestamp?: string;
  effort?: string;
  phase?: string;
  progress?: string;
  explored: string;
  discovered: string;
  decided: string;
  openThreads: string;
}

/** Fetch all digests across all sessions */
export function useDigests() {
  const [digests, setDigests] = useState<Digest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDigests() {
      try {
        const res = await fetch("/api/digests");
        const data = await res.json();
        setDigests(data);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    fetchDigests();
    const interval = setInterval(fetchDigests, 15_000);
    return () => clearInterval(interval);
  }, []);

  return { digests, loading };
}

/** Fetch digests for a specific session */
export function useSessionDigests(slug: string | null) {
  const [digests, setDigests] = useState<Digest[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!slug) {
      setDigests([]);
      return;
    }
    setLoading(true);
    async function fetchDigests() {
      try {
        const res = await fetch(`/api/digests/${slug}`);
        const data = await res.json();
        setDigests(data);
      } catch {
        setDigests([]);
      } finally {
        setLoading(false);
      }
    }
    fetchDigests();
  }, [slug]);

  return { digests, loading };
}
