import { useCallback, useEffect, useState } from "react";

export interface HarvestSummary {
  file: string;
  title: string;
  uuid: string | null;
  date: string | null;
  mtime: number;
  size: number;
  preview: string;
}

export interface HarvestDoc {
  file: string;
  title: string;
  uuid: string | null;
  date: string | null;
  raw: string;
  location: string;
}

/**
 * Load the harvest list. Harvests change rarely (only when the user clicks
 * ⛏ harvest on the Board), so a 30s poll + manual refresh is plenty — no need
 * for the Board's tight 10s cadence.
 */
export function useHarvests() {
  const [harvests, setHarvests] = useState<HarvestSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/harvests");
      const data = await res.json();
      setHarvests(Array.isArray(data) ? data : []);
    } catch {
      // keep last-known list on a transient failure
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  return { harvests, loading, refresh };
}

/** Fetch one harvest doc's full markdown. Returns null on 404/error. */
export async function fetchHarvest(file: string): Promise<HarvestDoc | null> {
  try {
    const res = await fetch(`/api/harvest/${encodeURIComponent(file)}`);
    if (!res.ok) return null;
    return (await res.json()) as HarvestDoc;
  } catch {
    return null;
  }
}
