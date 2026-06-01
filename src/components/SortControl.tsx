interface SortOption<T extends string> {
  key: T;
  label: string;
}

interface SortControlProps<T extends string> {
  value: T;
  options: SortOption<T>[];
  onChange: (next: T) => void;
}

/**
 * Segmented "Sort by" control. Presentational only — the chosen value is owned
 * by useSortPref so it persists per surface. Options are passed in because each
 * surface lists only the sorts that compose with its structure (e.g. the
 * project-grouped Notepad has no "Title" sort).
 */
export function SortControl<T extends string>({ value, options, onChange }: SortControlProps<T>) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-[var(--skein-text-muted)]">Sort</span>
      <div
        className="flex items-center rounded p-0.5 text-[11px] font-medium"
        style={{ background: "var(--skein-panel)" }}
      >
        {options.map((opt) => (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            className="rounded px-2 py-1 transition-colors"
            style={{
              background: value === opt.key ? "var(--skein-bg)" : "transparent",
              color: value === opt.key ? "var(--skein-accent)" : "var(--skein-text-muted)",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
