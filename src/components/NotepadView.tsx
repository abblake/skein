import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveState } from "../hooks/useLiveState";
import { useSessionTitles } from "../hooks/useSessionTitles";
import { useSortPref } from "../hooks/useSortPref";
import { SortControl } from "./SortControl";

interface ActiveSession {
  pid: number;
  tty: string;
  projectDirectory: string;
  projectName: string;
  command: string;
  startedAt: string;
  resumeId?: string;
  sessionId?: string;
  /** Last real activity (ISO) from the registry — the recency sort axis. */
  updatedAt?: string;
}

/** Recency axis for a session: registry updatedAt, else process start. */
function sessionRecency(s: ActiveSession): number {
  return +new Date(s.updatedAt || s.startedAt || 0);
}

type NotepadSort = "recent" | "project";

/** Must match sanitizeKey() in server/coherence/notepads.ts */
function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/** A stable note key per session. Prefer sessionId; fall back to dir+tty if missing. */
function sessionKey(s: ActiveSession): string {
  return s.sessionId ?? `${s.projectDirectory}-${s.tty}`;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";
type NoteMode = "freeform" | "log";

interface LogEntry {
  ts: string;
  body: string;
}

export function NotepadView() {
  const liveState = useLiveState();
  const titles = useSessionTitles();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [mode, setMode] = useState<NoteMode>("log");
  const [content, setContent] = useState("");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [vault, setVault] = useState<string | null>(null);
  const [noteKeys, setNoteKeys] = useState<Record<string, { updatedAt: string }>>({});
  const [sort, setSort] = useSortPref<NotepadSort>("notepad", "recent");
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Refs so the debounced/flush save always sees the latest values.
  const contentRef = useRef("");
  const selectedRef = useRef<{ dir: string; key: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  contentRef.current = content;

  // Group live sessions by project directory, but keep each session distinct.
  // Sessions within a group always sort newest-first (the hot session floats up);
  // the sort pref only controls how the *groups* are ordered.
  const groups = useMemo(() => {
    const map = new Map<string, { dir: string; name: string; sessions: ActiveSession[] }>();
    for (const s of (liveState.activeSessions ?? []) as ActiveSession[]) {
      if (!map.has(s.projectDirectory)) {
        map.set(s.projectDirectory, { dir: s.projectDirectory, name: s.projectName, sessions: [] });
      }
      map.get(s.projectDirectory)!.sessions.push(s);
    }
    for (const g of map.values()) {
      g.sessions.sort((a, b) => sessionRecency(b) - sessionRecency(a));
    }
    const list = [...map.values()];
    if (sort === "project") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // "recent": rank groups by their most-recently-active session.
      list.sort((a, b) => sessionRecency(b.sessions[0]) - sessionRecency(a.sessions[0]));
    }
    return list;
  }, [liveState, sort]);

  // Badge data: ask each cwd vault which keys already have notes.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      groups.map((g) =>
        fetch(`/api/notepad/keys?dir=${encodeURIComponent(g.dir)}`)
          .then((r) => r.json())
          .catch(() => ({}))
      )
    ).then((results) => {
      if (cancelled) return;
      const merged: Record<string, { updatedAt: string }> = {};
      for (const r of results) Object.assign(merged, r);
      setNoteKeys(merged);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveState.lastScan, groups.length]);

  async function saveNow(dir: string, key: string, body: string) {
    setStatus("saving");
    try {
      const res = await fetch("/api/notepad/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir, key, content: body }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus("saved");
        setSavedAt(data.updatedAt ?? null);
        setLocation(data.location ?? null);
        if (data.vault) setVault(data.vault);
        setNoteKeys((k) => ({ ...k, [sanitizeKey(key)]: { updatedAt: data.updatedAt } }));
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  async function selectSession(dir: string, key: string) {
    if (key === selectedKey) return;
    // Flush any pending edit for the session we're leaving.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (selectedRef.current) {
        await saveNow(selectedRef.current.dir, selectedRef.current.key, contentRef.current);
      }
    }
    setSelectedKey(key);
    selectedRef.current = { dir, key };
    setStatus("idle");
    setSavedAt(null);
    setLocation(null);
    setVault(null);
    setDraft("");
    setEntries([]);
    try {
      const res = await fetch(
        `/api/notepad?dir=${encodeURIComponent(dir)}&key=${encodeURIComponent(key)}`
      );
      const data = await res.json();
      setContent(data.content ?? "");
      setEntries(data.entries ?? []);
      setSavedAt(data.updatedAt ?? null);
      setLocation(data.location ?? null);
      setVault(data.vault ?? null);
    } catch {
      setContent("");
      setEntries([]);
    }
  }

  // Commit one log entry (Enter in the compose box). Server stamps the time.
  async function commitEntry() {
    const body = draft.trim();
    const sel = selectedRef.current;
    if (!body || !sel) return;
    setDraft("");
    setStatus("saving");
    try {
      const res = await fetch("/api/notepad/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: sel.dir, key: sel.key, body }),
      });
      const data = await res.json();
      if (data.ok) {
        setEntries(data.entries ?? []);
        setStatus("saved");
        setSavedAt(data.updatedAt ?? null);
        setLocation(data.location ?? null);
        if (data.vault) setVault(data.vault);
        setNoteKeys((k) => ({ ...k, [sanitizeKey(sel.key)]: { updatedAt: data.updatedAt } }));
      } else {
        setStatus("error");
        setDraft(body); // restore so nothing is lost
      }
    } catch {
      setStatus("error");
      setDraft(body);
    }
  }

  // Keep the newest entry in view as the log grows / on session switch.
  useEffect(() => {
    if (mode === "log") logEndRef.current?.scrollIntoView({ block: "end" });
  }, [entries, mode, selectedKey]);

  function onChange(value: string) {
    setContent(value);
    setStatus("saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    const sel = selectedRef.current;
    timerRef.current = setTimeout(() => {
      if (sel) saveNow(sel.dir, sel.key, value);
      timerRef.current = null;
    }, 800);
  }

  // Flush on unmount so a quick view-switch never loses an edit.
  useEffect(() => {
    return () => {
      if (timerRef.current && selectedRef.current) {
        clearTimeout(timerRef.current);
        navigator.sendBeacon?.(
          "/api/notepad/save",
          new Blob(
            [
              JSON.stringify({
                dir: selectedRef.current.dir,
                key: selectedRef.current.key,
                content: contentRef.current,
              }),
            ],
            { type: "application/json" }
          )
        );
      }
    };
  }, []);

  // Register the vault fresh, then hand off to Obsidian by vault id + file.
  async function openInObsidian() {
    if (!selectedKey) return;
    const dir = selectedRef.current?.dir;
    if (!dir) return;
    try {
      const res = await fetch("/api/notepad/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir, key: selectedKey }),
      });
      const data = await res.json();
      if (data.ok) {
        window.location.href = `obsidian://open?vault=${encodeURIComponent(
          data.vaultId
        )}&file=${encodeURIComponent(data.rel)}`;
      }
    } catch {
      // swallow — Reveal in Finder is the fallback
    }
  }

  function revealInFinder() {
    const dir = selectedRef.current?.dir;
    if (!dir) return;
    fetch("/api/notepad/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir }),
    }).catch(() => {});
  }

  // Resolve the selected session object (for the header).
  const selected = useMemo(() => {
    for (const g of groups) {
      const s = g.sessions.find((x) => sessionKey(x) === selectedKey);
      if (s) return { session: s, group: g };
    }
    return null;
  }, [groups, selectedKey]);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: live sessions, grouped by project */}
      <aside
        className="flex w-72 shrink-0 flex-col border-r"
        style={{ borderColor: "var(--skein-border)", background: "var(--skein-sidebar)" }}
      >
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--skein-border)" }}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Open Sessions</h2>
            <SortControl<NotepadSort>
              value={sort}
              onChange={setSort}
              options={[
                { key: "recent", label: "Recent" },
                { key: "project", label: "Project" },
              ]}
            />
          </div>
          <p className="mt-1 text-[11px] text-[var(--skein-text-muted)]">
            {groups.reduce((n, g) => n + g.sessions.length, 0)} live ·{" "}
            {groups.length} {groups.length === 1 ? "project" : "projects"}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {groups.length === 0 && (
            <p className="px-4 py-6 text-xs text-[var(--skein-text-muted)]">
              No live Claude sessions detected.
            </p>
          )}
          {groups.map((g) => (
            <div key={g.dir}>
              <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--skein-text-muted)]">
                {g.name}
              </div>
              {g.sessions.map((s) => {
                const key = sessionKey(s);
                const active = key === selectedKey;
                const hasNote = !!noteKeys[sanitizeKey(key)];
                const title = s.sessionId ? titles[s.sessionId]?.title : undefined;
                return (
                  <button
                    key={key}
                    onClick={() => selectSession(s.projectDirectory, key)}
                    className="flex w-full flex-col gap-0.5 border-b px-4 py-2 text-left transition-colors"
                    style={{
                      borderColor: "var(--skein-border)",
                      background: active ? "var(--skein-panel)" : "transparent",
                    }}
                  >
                    <div className="flex w-full items-center gap-2">
                      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
                      <span className="flex-1 truncate text-[12px] font-medium">
                        {title ?? `Session ${s.tty.replace(/^tty/, "")}`}
                      </span>
                      {hasNote && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: "var(--skein-accent)" }}
                          title="has notes"
                        />
                      )}
                    </div>
                    <span className="truncate pl-4 text-[10px] text-[var(--skein-text-muted)]">
                      {s.tty} · pid {s.pid}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* Right: notepad */}
      <main className="flex flex-1 flex-col bg-[var(--skein-bg)]">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-[var(--skein-text-muted)]">
              Select a session to open its scratchpad
            </p>
          </div>
        ) : (
          <>
            <div
              className="flex items-center justify-between border-b px-6 py-3"
              style={{ borderColor: "var(--skein-border)" }}
            >
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">
                  {(selected.session.sessionId && titles[selected.session.sessionId]?.title) ||
                    selected.group.name}
                  <span className="ml-2 text-xs font-normal text-[var(--skein-text-muted)]">
                    {selected.group.name} · {selected.session.tty} · pid {selected.session.pid}
                  </span>
                </h2>
                <p className="truncate text-[11px] text-[var(--skein-text-muted)]" title={location ?? ""}>
                  {location ?? selected.session.projectDirectory + "/skein/notepad/"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 pl-4">
                <div
                  className="flex items-center rounded p-0.5 text-[11px] font-medium"
                  style={{ background: "var(--skein-panel)" }}
                >
                  {(["log", "freeform"] as NoteMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className="rounded px-2 py-1 capitalize transition-colors"
                      style={{
                        background: mode === m ? "var(--skein-bg)" : "transparent",
                        color: mode === m ? "var(--skein-accent)" : "var(--skein-text-muted)",
                      }}
                    >
                      {m === "log" ? "Log" : "Freeform"}
                    </button>
                  ))}
                </div>
                {vault && (
                  <>
                    <button
                      onClick={openInObsidian}
                      className="rounded px-2 py-1 text-[11px] font-medium transition-colors"
                      style={{ background: "var(--skein-panel)", color: "var(--skein-accent)" }}
                      title={`Register + open this vault in Obsidian (${vault})`}
                    >
                      Open in Obsidian ↗
                    </button>
                    <button
                      onClick={revealInFinder}
                      className="rounded px-2 py-1 text-[11px] font-medium text-[var(--skein-text-muted)] transition-colors hover:text-[var(--skein-text)]"
                      style={{ background: "var(--skein-panel)" }}
                      title="Reveal the vault folder in Finder"
                    >
                      Finder
                    </button>
                  </>
                )}
                <span className="pl-1 text-[11px] text-[var(--skein-text-muted)]">
                  {status === "saving" && "Saving…"}
                  {status === "saved" && "Saved ✓"}
                  {status === "error" && <span className="text-red-400">Save failed</span>}
                  {status === "idle" && savedAt && `Saved ${new Date(savedAt).toLocaleString()}`}
                </span>
              </div>
            </div>
            {mode === "freeform" ? (
              <textarea
                value={content}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Thoughts, ideas, TODOs for this session… auto-saves into this project's skein/notepad vault."
                spellCheck={false}
                className="flex-1 resize-none bg-transparent p-6 font-mono text-[13px] leading-relaxed text-[var(--skein-text)] outline-none placeholder:text-[var(--skein-text-muted)]/50"
              />
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-6 py-4 font-mono text-[13px] leading-relaxed">
                  {entries.length === 0 ? (
                    <p className="pt-2 text-[var(--skein-text-muted)]/60">
                      No entries yet. Type below and press Enter to log a timestamped note.
                    </p>
                  ) : (
                    entries.map((e, i) => {
                      const d = new Date(e.ts);
                      const day = d.toLocaleDateString([], {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      });
                      const prevDay =
                        i > 0 ? new Date(entries[i - 1].ts).toLocaleDateString() : null;
                      const showDay = prevDay !== d.toLocaleDateString();
                      const time = d.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                      return (
                        <div key={`${e.ts}-${i}`}>
                          {showDay && (
                            <div className="mt-3 mb-1 select-none text-[10px] font-semibold uppercase tracking-wide text-[var(--skein-text-muted)]/70">
                              {day}
                            </div>
                          )}
                          <div className="flex gap-3 py-1">
                            <span
                              className="shrink-0 select-none pt-px text-right text-[11px] tabular-nums text-[var(--skein-text-muted)]"
                              style={{ width: "3.5rem" }}
                            >
                              {time}
                            </span>
                            <span className="min-w-0 whitespace-pre-wrap break-words text-[var(--skein-text)]">
                              {e.body}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={logEndRef} />
                </div>
                <div
                  className="flex items-end gap-2 border-t px-6 py-3"
                  style={{ borderColor: "var(--skein-border)" }}
                >
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        commitEntry();
                      }
                    }}
                    rows={1}
                    placeholder="Log a note… Enter to add · Shift+Enter for a new line"
                    spellCheck={false}
                    className="max-h-32 flex-1 resize-none bg-transparent py-1 font-mono text-[13px] leading-relaxed text-[var(--skein-text)] outline-none placeholder:text-[var(--skein-text-muted)]/50"
                  />
                  <button
                    onClick={commitEntry}
                    disabled={!draft.trim()}
                    className="shrink-0 rounded px-3 py-1 text-[11px] font-medium transition-colors disabled:opacity-30"
                    style={{ background: "var(--skein-panel)", color: "var(--skein-accent)" }}
                  >
                    Log ⏎
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
