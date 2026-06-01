import { useCallback, useState } from "react";

/**
 * Per-surface sort preference, persisted to localStorage.
 *
 * Sort is a personal UI setting — never a server round-trip, never touches a
 * PAI file or ~/.claude/skein/. Each surface ("board", "notepad", …) keeps its
 * own choice (decision: per-surface state, shared options), so the Board can be
 * recency-sorted while the Notepad stays grouped by project.
 */
export function useSortPref<T extends string>(surface: string, fallback: T) {
  const storageKey = `skein:sort:${surface}`;

  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return (stored as T) || fallback;
    } catch {
      return fallback;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Private mode / disabled storage — sort still works for this session.
      }
    },
    [storageKey]
  );

  return [value, set] as const;
}
