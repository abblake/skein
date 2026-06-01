import { useEffect, useState } from "react";

interface ParsedCriterion {
  id: string;
  description: string;
  checked: boolean;
}

interface PrdData {
  frontmatter: Record<string, string>;
  sections: Record<string, string>;
  criteria: ParsedCriterion[];
  raw: string;
}

export function usePrd(slug: string | null) {
  const [prd, setPrd] = useState<PrdData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!slug) {
      setPrd(null);
      return;
    }
    setLoading(true);
    async function fetchPrd() {
      try {
        const res = await fetch(`/api/prds/${slug}`);
        if (!res.ok) {
          setPrd(null);
          return;
        }
        const data = await res.json();
        setPrd(data);
      } catch (err) {
        console.error("Failed to fetch PRD:", err);
        setPrd(null);
      } finally {
        setLoading(false);
      }
    }
    fetchPrd();
  }, [slug]);

  return { prd, loading };
}
