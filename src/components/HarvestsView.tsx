import { useEffect, useState } from "react";
import { fetchHarvest, useHarvests, type HarvestDoc } from "../hooks/useHarvests";

type CopyState = "idle" | "path" | "prompt";

/** A ready-to-paste instruction that hands the harvest to a Claude session for
 *  promotion. Skein only copies this text — it never authors the skill itself. */
function promotePrompt(doc: HarvestDoc): string {
  return (
    `Promote the harvest at ${doc.location} into a PAI skill using the CreateSkill skill. ` +
    `Read the doc, decide if it earns its keep, and if so scaffold a canonical skill from it. ` +
    `Skein cannot write to ~/.claude/PAI/ — you (this session) do the authoring.`
  );
}

export function HarvestsView() {
  const { harvests, loading, refresh } = useHarvests();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [doc, setDoc] = useState<HarvestDoc | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [copied, setCopied] = useState<CopyState>("idle");

  // Auto-select the newest harvest once the list loads.
  useEffect(() => {
    if (!selectedFile && harvests.length > 0) setSelectedFile(harvests[0].file);
  }, [harvests, selectedFile]);

  // Load the selected doc.
  useEffect(() => {
    if (!selectedFile) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    setDocLoading(true);
    setCopied("idle");
    fetchHarvest(selectedFile).then((d) => {
      if (!cancelled) {
        setDoc(d);
        setDocLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedFile]);

  async function copy(text: string, which: CopyState) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied("idle"), 2000);
    } catch {
      // clipboard blocked — nothing destructive happened
    }
  }

  function revealInFinder() {
    if (!doc) return;
    fetch("/api/harvest/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: doc.file }),
    }).catch(() => {});
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: harvest list */}
      <aside
        className="flex w-72 shrink-0 flex-col border-r"
        style={{ borderColor: "var(--skein-border)", background: "var(--skein-sidebar)" }}
      >
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--skein-border)" }}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Harvests</h2>
            <button
              onClick={() => void refresh()}
              className="rounded px-2 py-0.5 text-[10px] font-medium transition-colors"
              style={{ background: "var(--skein-panel)", color: "var(--skein-text-muted)" }}
              title="Re-scan the harvests folder"
            >
              refresh
            </button>
          </div>
          <p className="mt-1 text-[11px] text-[var(--skein-text-muted)]">
            {loading
              ? "scanning…"
              : `${harvests.length} ${harvests.length === 1 ? "harvest" : "harvests"}`}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!loading && harvests.length === 0 && (
            <p className="px-4 py-6 text-xs text-[var(--skein-text-muted)]">
              No harvests yet. Click ⛏ harvest on a thread card in the Parking Lot to distill it
              into a reusable skill doc.
            </p>
          )}
          {harvests.map((h) => {
            const active = h.file === selectedFile;
            return (
              <button
                key={h.file}
                onClick={() => setSelectedFile(h.file)}
                className="flex w-full flex-col gap-0.5 border-b px-4 py-2 text-left transition-colors"
                style={{
                  borderColor: "var(--skein-border)",
                  background: active ? "var(--skein-panel)" : "transparent",
                }}
              >
                <span className="truncate text-[12px] font-medium" style={{ color: "var(--skein-text)" }}>
                  {h.title}
                </span>
                <span className="flex items-center gap-2 text-[10px] text-[var(--skein-text-muted)]">
                  {h.date && <span>{h.date}</span>}
                  {h.uuid && <span className="font-mono">{h.uuid.slice(0, 8)}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Right: harvest content (read-only) */}
      <main className="flex flex-1 flex-col bg-[var(--skein-bg)]">
        {!selectedFile ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-[var(--skein-text-muted)]">
              Select a harvest to read it
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
                  {doc?.title ?? selectedFile}
                </h2>
                <p
                  className="truncate text-[11px] text-[var(--skein-text-muted)]"
                  title={doc?.location ?? ""}
                >
                  {doc?.location ?? selectedFile}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 pl-4">
                <button
                  onClick={() => doc && copy(doc.location, "path")}
                  disabled={!doc}
                  className="rounded px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-30"
                  style={{ background: "var(--skein-panel)", color: "var(--skein-text)" }}
                  title="Copy the harvest's absolute path"
                >
                  {copied === "path" ? "Copied ✓" : "Copy path"}
                </button>
                <button
                  onClick={() => doc && copy(promotePrompt(doc), "prompt")}
                  disabled={!doc}
                  className="rounded px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-30"
                  style={{ background: "var(--skein-panel)", color: "var(--skein-accent)" }}
                  title="Copy a ready-to-paste 'promote to PAI skill' prompt for a Claude session"
                >
                  {copied === "prompt" ? "Copied ✓" : "Copy promote prompt"}
                </button>
                <button
                  onClick={revealInFinder}
                  disabled={!doc}
                  className="rounded px-2 py-1 text-[11px] font-medium text-[var(--skein-text-muted)] transition-colors hover:text-[var(--skein-text)] disabled:opacity-30"
                  style={{ background: "var(--skein-panel)" }}
                  title="Reveal the harvests folder in Finder"
                >
                  Finder
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {docLoading ? (
                <p className="text-sm text-[var(--skein-text-muted)]">Loading…</p>
              ) : doc ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-[var(--skein-text)]">
                  {doc.raw}
                </pre>
              ) : (
                <p className="text-sm text-red-400">Could not load this harvest.</p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
