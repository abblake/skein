import { useEffect, useState } from "react";
import { useThreads, type ThreadCard, type Column } from "../hooks/useThreads";
import { useSortPref } from "../hooks/useSortPref";
import { SortControl } from "./SortControl";

type BoardSort = "recent" | "title" | "project";

/** Compare two cards for the chosen sort. Applied within a column only —
 *  sort never moves a card between columns (manual filing wins, per ISC-8/9). */
function compareCards(a: ThreadCard, b: ThreadCard, sort: BoardSort): number {
  if (sort === "title") return a.title.localeCompare(b.title);
  if (sort === "project") return a.projectDir.localeCompare(b.projectDir);
  return +new Date(b.lastActiveAt) - +new Date(a.lastActiveAt); // "recent"
}

async function openThread(id: string): Promise<string> {
  try {
    const res = await fetch(`/api/thread/${encodeURIComponent(id)}/open`, { method: "POST" });
    const data = await res.json();
    return data.ok ? (data.action === "focus" ? "focused" : "resuming…") : data.detail || "failed";
  } catch {
    return "failed";
  }
}

async function harvestThread(id: string): Promise<string> {
  try {
    const res = await fetch(`/api/thread/${encodeURIComponent(id)}/harvest`, { method: "POST" });
    const data = await res.json();
    return data.ok ? "harvested ✓" : data.detail || "failed";
  } catch {
    return "failed";
  }
}

async function setColumn(id: string, column: Column): Promise<void> {
  try {
    await fetch(`/api/thread/${encodeURIComponent(id)}/column`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column }),
    });
  } catch {
    // poll will re-sync from server truth
  }
}

const COLUMNS: { key: Column; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "parked", label: "Parked" },
  { key: "waiting", label: "Waiting" },
  { key: "done", label: "Done" },
];

// Stable, pleasant color per project id (for the lane tag on each card).
const TAG_COLORS = ["#6c8cff", "#4ade80", "#fbbf24", "#f87171", "#c084fc", "#22d3ee", "#fb923c"];
function projectColor(projectId: string): string {
  let h = 0;
  for (let i = 0; i < projectId.length; i++) h = (h * 31 + projectId.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

/** Human-readable lane name from the slugified project id (last 1–2 path parts). */
function laneName(projectDir: string): string {
  const parts = projectDir.split("/").filter(Boolean);
  return parts.slice(-1)[0] ?? projectDir;
}

/** Live-activity dot: color + whether it pulses + a human label. */
function statusDot(card: ThreadCard): { color: string; pulse: boolean; label: string } {
  if (!card.live) return { color: "var(--skein-border)", pulse: false, label: "closed — resumable" };
  switch (card.status) {
    case "busy":    return { color: "var(--skein-green)", pulse: true,  label: "working now" };
    case "waiting": return { color: "var(--skein-amber)", pulse: true,  label: "waiting on you" };
    case "shell":   return { color: "var(--skein-accent)", pulse: false, label: "in a shell command" };
    default:        return { color: "var(--skein-green)", pulse: false, label: "live — idle" };
  }
}

/** Mirror the server's filing rule for optimistic UI. */
function columnAfterDrop(card: ThreadCard, target: Column): Column {
  if (target === "waiting" || target === "done") return target;
  return card.live ? "live" : "parked"; // unfile → auto
}

/** Can this card actually land in this column? (Parked is auto-only for live windows.) */
function canDrop(card: ThreadCard, target: Column): boolean {
  if (target === "waiting" || target === "done") return true; // filing always allowed
  if (target === "live") return card.live;   // can't manually make a closed session live
  return !card.live;                          // can't park a running window — it auto-parks
}

function Card({
  card,
  onDragStartCard,
  onDragEndCard,
}: {
  card: ThreadCard;
  onDragStartCard: (id: string) => void;
  onDragEndCard: () => void;
}) {
  const color = projectColor(card.projectId);
  const [status, setStatus] = useState<string | null>(null);

  async function handleOpen() {
    setStatus(card.live ? "focusing…" : "resuming…");
    const result = await openThread(card.id);
    setStatus(result);
    setTimeout(() => setStatus(null), 2500);
  }

  async function handleHarvest(e: React.MouseEvent) {
    e.stopPropagation(); // don't trigger card open
    setStatus("harvesting…");
    const result = await harvestThread(card.id);
    setStatus(result);
    setTimeout(() => setStatus(null), 3000);
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStartCard(card.id);
      }}
      onDragEnd={onDragEndCard}
      onClick={handleOpen}
      title={card.live ? "Focus this window" : "Resume in a new Terminal window"}
      className="group cursor-pointer rounded-lg border p-3 transition-colors hover:border-[var(--skein-accent)] active:cursor-grabbing"
      style={{
        background: "var(--skein-panel)",
        borderColor: "var(--skein-border)",
        opacity: card.stale ? 0.5 : 1,
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        {(() => {
          const dot = statusDot(card);
          return (
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${dot.pulse ? "animate-pulse" : ""}`}
              style={{ background: dot.color, boxShadow: card.live ? `0 0 6px ${dot.color}` : "none" }}
              title={dot.label}
            />
          );
        })()}
        <span
          className="truncate rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
          style={{ background: `${color}22`, color }}
          title={card.projectDir}
        >
          {laneName(card.projectDir)}
        </span>
        {card.live && card.status === "waiting" && (
          <span
            className="ml-auto rounded px-1 text-[10px] font-semibold uppercase"
            style={{ background: "#fbbf2422", color: "var(--skein-amber)" }}
          >
            needs you
          </span>
        )}
        {card.stale && (
          <span className="ml-auto text-[10px]" style={{ color: "var(--skein-text-muted)" }}>
            stale
          </span>
        )}
      </div>
      <p className="text-sm leading-snug" style={{ color: "var(--skein-text)" }}>
        {card.title}
      </p>
      {(card.digest || !card.live) && (
        <p
          className="mt-1.5 border-l-2 pl-2 text-xs italic leading-snug"
          style={{ borderColor: "var(--skein-border)", color: "var(--skein-text-muted)" }}
        >
          {card.digest ?? "summarizing…"}
        </p>
      )}
      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px]" style={{ color: "var(--skein-text-muted)" }}>
            {card.uuid.slice(0, 8)}
          </span>
          {card.goalId && (
            <span
              className="rounded px-1 text-[10px] font-semibold"
              style={{ background: "#6c8cff22", color: "var(--skein-accent)" }}
              title={card.goalLabel}
            >
              {card.goalId}
            </span>
          )}
          {card.recurring && (
            <span
              className="rounded px-1 text-[10px] font-semibold"
              style={{ background: "#4ade8022", color: "var(--skein-green)" }}
              title="You return here often — consider scheduling a recurring check (run /schedule)"
            >
              ↻ rhythm
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status ? (
            <span className="text-[10px] font-medium" style={{ color: "var(--skein-accent)" }}>
              {status}
            </span>
          ) : (
            <button
              onClick={handleHarvest}
              title="Harvest this thread into a reusable skill doc"
              className="text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
              style={{ color: "var(--skein-text-muted)" }}
            >
              ⛏ harvest
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function Board() {
  const { store, loading } = useThreads();
  const [cards, setCards] = useState<ThreadCard[]>([]);
  const [dragOver, setDragOver] = useState<Column | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useSortPref<BoardSort>("board", "recent");
  const [briefing, setBriefing] = useState<{ text: string; generatedAt: string | null } | null>(null);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [briefingLoading, setBriefingLoading] = useState(false);

  // Keep local cards synced with the poll (server is source of truth).
  useEffect(() => setCards(store.cards), [store]);

  async function loadBriefing(force = false) {
    setBriefingLoading(true);
    try {
      const res = await fetch(`/api/threads/briefing${force ? "?force=1" : ""}`);
      setBriefing(await res.json());
    } catch {
      /* ignore */
    } finally {
      setBriefingLoading(false);
    }
  }
  useEffect(() => { void loadBriefing(false); }, []);

  const draggingCard = draggingId ? cards.find((c) => c.id === draggingId) ?? null : null;

  // Search filters which cards are visible (title/digest/project/goal), instant.
  const q = query.trim().toLowerCase();
  const matches = (c: ThreadCard) =>
    !q ||
    [c.title, c.digest, c.projectDir, c.goalId, c.goalLabel]
      .filter(Boolean)
      .some((s) => (s as string).toLowerCase().includes(q));

  function handleDrop(target: Column, id: string) {
    setDragOver(null);
    const card = cards.find((c) => c.id === id);
    if (!card || !canDrop(card, target)) return;
    const next = columnAfterDrop(card, target);
    const filed = next === "waiting" || next === "done";
    // Optimistic: move immediately, reconcile on next poll.
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, column: next, filed } : c)));
    void setColumn(id, target);
  }

  const byColumn = (col: Column) =>
    cards
      .filter((c) => c.column === col && matches(c))
      .sort((a, b) => compareCards(a, b, sort));

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--skein-bg)" }}>
      <header
        className="flex items-center gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--skein-border)" }}
      >
        <h1 className="text-sm font-semibold" style={{ color: "var(--skein-text)" }}>
          Parking Lot
        </h1>
        <span className="text-xs" style={{ color: "var(--skein-text-muted)" }}>
          {loading ? "scanning…" : `${cards.length} threads`}
          {store.lastScan && ` · updated ${new Date(store.lastScan).toLocaleTimeString()}`}
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search threads…"
          className="ml-auto w-56 rounded border px-2 py-1 text-xs outline-none"
          style={{ background: "var(--skein-panel)", borderColor: "var(--skein-border)", color: "var(--skein-text)" }}
        />
        <SortControl<BoardSort>
          value={sort}
          onChange={setSort}
          options={[
            { key: "recent", label: "Recent" },
            { key: "title", label: "Title" },
            { key: "project", label: "Project" },
          ]}
        />
        <button
          onClick={() => setBriefingOpen((v) => !v)}
          className="rounded px-2 py-1 text-xs font-medium"
          style={{ background: "var(--skein-panel)", color: "var(--skein-text)" }}
        >
          {briefingOpen ? "hide briefing" : "briefing"}
        </button>
      </header>

      {briefingOpen && (
        <div
          className="flex items-start gap-3 border-b px-5 py-3 text-xs leading-relaxed"
          style={{ borderColor: "var(--skein-border)", background: "var(--skein-sidebar)", color: "var(--skein-text)" }}
        >
          <span aria-hidden style={{ fontSize: 14 }}>🧭</span>
          <p className="flex-1 whitespace-pre-wrap">
            {briefingLoading ? "Synthesizing briefing…" : briefing?.text ?? "No briefing yet."}
          </p>
          <button
            onClick={() => loadBriefing(true)}
            disabled={briefingLoading}
            className="shrink-0 rounded px-2 py-0.5 text-[10px]"
            style={{ background: "var(--skein-panel)", color: "var(--skein-text-muted)" }}
          >
            refresh
          </button>
        </div>
      )}

      <div className="grid flex-1 grid-cols-4 gap-3 overflow-hidden p-4">
        {COLUMNS.map(({ key, label }) => {
          const colCards = byColumn(key);
          // While dragging, is this column a valid landing spot for that card?
          const droppable = draggingCard ? canDrop(draggingCard, key) : true;
          const isOver = dragOver === key && droppable;
          const blocked = !!draggingCard && !droppable;
          return (
            <section
              key={key}
              onDragOver={(e) => {
                if (draggingCard && !droppable) {
                  e.dataTransfer.dropEffect = "none"; // not-allowed cursor; reject
                  return; // no preventDefault → browser blocks the drop
                }
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragOver !== key) setDragOver(key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(key, e.dataTransfer.getData("text/plain"));
              }}
              className="flex min-h-0 flex-col rounded-lg transition-colors"
              style={{
                background: isOver ? "var(--skein-sidebar)" : "transparent",
                opacity: blocked ? 0.4 : 1,
              }}
            >
              <div className="mb-2 flex items-center gap-2 px-1 pt-1">
                <h2
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: "var(--skein-text-muted)" }}
                >
                  {label}
                </h2>
                <span
                  className="rounded-full px-1.5 text-[10px]"
                  style={{ background: "var(--skein-sidebar)", color: "var(--skein-text-muted)" }}
                >
                  {colCards.length}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-1 pb-1">
                {colCards.map((c) => (
                  <Card
                    key={c.id}
                    card={c}
                    onDragStartCard={setDraggingId}
                    onDragEndCard={() => {
                      setDraggingId(null);
                      setDragOver(null);
                    }}
                  />
                ))}
                {colCards.length === 0 && (
                  <p
                    className="rounded border border-dashed px-2 py-3 text-center text-xs"
                    style={{ borderColor: "var(--skein-border)", color: "var(--skein-text-muted)" }}
                  >
                    {key === "waiting" || key === "done" ? "drop here" : "—"}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
