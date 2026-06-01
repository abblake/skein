import { useMemo } from "react";

interface PlanMarkdownProps {
  source: string;
}

type Energy = "HIGH" | "MEDIUM" | "LOW" | null;

interface MetaField {
  label: string;
  value: string;
}

interface TaskLine {
  kind: "task";
  text: string;
  energy: Energy;
  duration: string | null;
  checked: boolean;
}

interface BulletLine {
  kind: "bullet";
  text: string;
}

interface PhaseTotalLine {
  kind: "total";
  text: string;
}

type PhaseItem = TaskLine | BulletLine | PhaseTotalLine;

interface Phase {
  title: string;
  energyWindow: Energy;
  energyReason: string;
  items: PhaseItem[];
}

interface Section {
  heading: string;
  lines: string[];
}

interface ParsedPlan {
  title: string | null;
  meta: MetaField[];
  context: string[];
  phases: Phase[];
  extraSections: Section[];
}

const ENERGY_TOKENS = new Set(["HIGH", "MEDIUM", "LOW"]);

function parseTaskSuffix(raw: string): {
  text: string;
  energy: Energy;
  duration: string | null;
} {
  // Pattern: "Task text — ENERGY — XX min"  (em-dash separated; sometimes only duration)
  const parts = raw.split(/\s+—\s+/);
  if (parts.length >= 3) {
    const maybeEnergy = parts[parts.length - 2].trim().toUpperCase();
    const maybeDuration = parts[parts.length - 1].trim();
    if (ENERGY_TOKENS.has(maybeEnergy) && /min|hr|hour/i.test(maybeDuration)) {
      return {
        text: parts.slice(0, parts.length - 2).join(" — ").trim(),
        energy: maybeEnergy as Energy,
        duration: maybeDuration,
      };
    }
  }
  if (parts.length === 2) {
    const maybeDuration = parts[1].trim();
    if (/min|hr|hour/i.test(maybeDuration)) {
      return { text: parts[0].trim(), energy: null, duration: maybeDuration };
    }
  }
  return { text: raw.trim(), energy: null, duration: null };
}

function parseEnergyWindow(line: string): { energy: Energy; reason: string } {
  // "Energy Window: HIGH — reason text"
  const match = line.match(
    /Energy Window:\s*(HIGH|MEDIUM|LOW)\s*(?:—|-)?\s*(.*)$/i
  );
  if (!match) return { energy: null, reason: "" };
  return {
    energy: match[1].toUpperCase() as Energy,
    reason: (match[2] ?? "").trim(),
  };
}

function parsePlan(source: string): ParsedPlan {
  const lines = source.split("\n");
  const result: ParsedPlan = {
    title: null,
    meta: [],
    context: [],
    phases: [],
    extraSections: [],
  };

  let section:
    | "preamble"
    | "context"
    | "phase"
    | "extra"
    | null = "preamble";
  let currentPhase: Phase | null = null;
  let currentExtra: Section | null = null;

  const commitPhase = () => {
    if (currentPhase) {
      result.phases.push(currentPhase);
      currentPhase = null;
    }
  };
  const commitExtra = () => {
    if (currentExtra) {
      result.extraSections.push(currentExtra);
      currentExtra = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    const trimmed = line.trim();

    // H1 title
    if (!result.title && /^#\s+/.test(trimmed)) {
      result.title = trimmed.replace(/^#\s+/, "").trim();
      continue;
    }

    // Metadata lines like "**Label:** value"
    const metaMatch = trimmed.match(/^\*\*([^*]+):\*\*\s*(.*)$/);
    if (metaMatch && section === "preamble") {
      result.meta.push({
        label: metaMatch[1].trim(),
        value: metaMatch[2].trim(),
      });
      continue;
    }

    // Section header ## Context
    if (/^##\s+Context\s*$/i.test(trimmed)) {
      commitPhase();
      commitExtra();
      section = "context";
      continue;
    }

    // Section header ## PHASE N: name
    const phaseMatch = trimmed.match(/^##\s+PHASE\s+(\d+)\s*:\s*(.*)$/i);
    if (phaseMatch) {
      commitPhase();
      commitExtra();
      section = "phase";
      currentPhase = {
        title: `PHASE ${phaseMatch[1]}: ${phaseMatch[2].trim()}`,
        energyWindow: null,
        energyReason: "",
        items: [],
      };
      continue;
    }

    // Any other ## heading → extra section
    const otherHeading = trimmed.match(/^##\s+(.*)$/);
    if (otherHeading) {
      commitPhase();
      commitExtra();
      section = "extra";
      currentExtra = { heading: otherHeading[1].trim(), lines: [] };
      continue;
    }

    if (section === "context") {
      if (trimmed.length === 0 && result.context.length === 0) continue;
      result.context.push(line);
      continue;
    }

    if (section === "phase" && currentPhase) {
      if (/^Energy Window:/i.test(trimmed)) {
        const { energy, reason } = parseEnergyWindow(trimmed);
        currentPhase.energyWindow = energy;
        currentPhase.energyReason = reason;
        continue;
      }
      // Phase total line: "PHASE N TOTAL: ..." (plain, not bulleted)
      if (/^PHASE\s+\d+\s+TOTAL:/i.test(trimmed)) {
        currentPhase.items.push({ kind: "total", text: trimmed });
        continue;
      }
      // Task checkbox: "- [ ] ..." or "- [x] ..."
      const taskMatch = trimmed.match(/^-\s+\[( |x|X)\]\s+(.*)$/);
      if (taskMatch) {
        const checked = taskMatch[1].toLowerCase() === "x";
        const { text, energy, duration } = parseTaskSuffix(taskMatch[2]);
        currentPhase.items.push({
          kind: "task",
          text,
          energy,
          duration,
          checked,
        });
        continue;
      }
      // Plain bullet: "- text"
      const bulletMatch = trimmed.match(/^-\s+(.*)$/);
      if (bulletMatch) {
        currentPhase.items.push({
          kind: "bullet",
          text: bulletMatch[1].trim(),
        });
        continue;
      }
      // Skip blank/other lines inside phase
      continue;
    }

    if (section === "extra" && currentExtra) {
      currentExtra.lines.push(line);
      continue;
    }
  }

  commitPhase();
  commitExtra();

  return result;
}

function energyChipClass(energy: Energy): string {
  if (energy === "HIGH") {
    return "bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/30";
  }
  if (energy === "MEDIUM") {
    return "bg-[var(--skein-amber)]/15 text-[var(--skein-amber)] ring-1 ring-inset ring-[var(--skein-amber)]/30";
  }
  if (energy === "LOW") {
    return "bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-500/30";
  }
  return "bg-[var(--skein-bg)] text-[var(--skein-text-muted)] ring-1 ring-inset ring-[var(--skein-border)]";
}

/** Render minimal inline markdown: **bold** and `code`. Safe — no HTML injection. */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key++} className="font-semibold text-[var(--skein-text)]">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-[var(--skein-bg)] px-1 py-0.5 font-mono text-[10.5px] text-[var(--skein-text)]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function renderContext(lines: string[]): React.ReactNode {
  // Group into paragraphs separated by blank lines.
  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      if (current.length > 0) {
        paragraphs.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) paragraphs.push(current);

  return paragraphs.map((para, i) => (
    <p
      key={i}
      className="text-[12px] leading-relaxed text-[var(--skein-text)]"
    >
      {renderInline(para.join(" "))}
    </p>
  ));
}

function renderExtraSection(section: Section): React.ReactNode {
  // Render bullets as ul, numbered "1. ..." lines as ol, everything else as paragraphs.
  const bullets: string[] = [];
  const numbered: string[] = [];
  const paragraphs: string[] = [];
  for (const raw of section.lines) {
    const t = raw.trim();
    if (t.length === 0) continue;
    if (/^-\s+/.test(t)) {
      bullets.push(t.replace(/^-\s+/, ""));
    } else if (/^\d+\.\s+/.test(t)) {
      numbered.push(t.replace(/^\d+\.\s+/, ""));
    } else {
      paragraphs.push(t);
    }
  }
  return (
    <div className="space-y-2">
      {paragraphs.map((p, i) => (
        <p
          key={`p-${i}`}
          className="text-[12px] leading-relaxed text-[var(--skein-text)]"
        >
          {renderInline(p)}
        </p>
      ))}
      {bullets.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-[var(--skein-text)] marker:text-[var(--skein-text-muted)]">
          {bullets.map((b, i) => (
            <li key={`b-${i}`}>{renderInline(b)}</li>
          ))}
        </ul>
      )}
      {numbered.length > 0 && (
        <ol className="list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-[var(--skein-text)] marker:text-[var(--skein-text-muted)]">
          {numbered.map((n, i) => (
            <li key={`n-${i}`}>{renderInline(n)}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function PlanMarkdown({ source }: PlanMarkdownProps) {
  const parsed = useMemo(() => parsePlan(source), [source]);

  return (
    <div className="max-h-[32rem] overflow-y-auto pr-1">
      <div className="space-y-5">
        {parsed.title && (
          <h1 className="text-base font-semibold leading-tight text-[var(--skein-accent)]">
            {parsed.title}
          </h1>
        )}

        {parsed.meta.length > 0 && (
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[11px]">
            {parsed.meta.map((m) => (
              <div key={m.label} className="contents">
                <dt className="font-medium uppercase tracking-wide text-[var(--skein-text-muted)]">
                  {m.label}
                </dt>
                <dd className="break-words text-[var(--skein-text)]">
                  {renderInline(m.value)}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {parsed.context.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[var(--skein-text-muted)]">
              Context
            </h2>
            {renderContext(parsed.context)}
          </section>
        )}

        {parsed.phases.map((phase, i) => (
          <section
            key={`phase-${i}`}
            className="rounded border-l-2 border-[var(--skein-accent)]/60 bg-[var(--skein-bg)]/40 px-3 py-2"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-[12px] font-semibold text-[var(--skein-text)]">
                {phase.title}
              </h2>
              {phase.energyWindow && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${energyChipClass(phase.energyWindow)}`}
                  title={phase.energyReason}
                >
                  {phase.energyWindow}
                </span>
              )}
              {phase.energyReason && (
                <span className="text-[10.5px] italic text-[var(--skein-text-muted)]">
                  {phase.energyReason}
                </span>
              )}
            </div>

            <ul className="space-y-1">
              {phase.items.map((item, j) => {
                if (item.kind === "total") {
                  return (
                    <li
                      key={j}
                      className="pt-1 text-right text-[10px] font-medium uppercase tracking-wide text-[var(--skein-text-muted)]"
                    >
                      {item.text}
                    </li>
                  );
                }
                if (item.kind === "bullet") {
                  return (
                    <li
                      key={j}
                      className="flex items-start gap-2 text-[11.5px] text-[var(--skein-text-muted)]"
                    >
                      <span className="mt-[2px] text-[var(--skein-text-muted)]/60">
                        •
                      </span>
                      <span className="flex-1">{renderInline(item.text)}</span>
                    </li>
                  );
                }
                // task
                const glyph = item.checked ? "☑" : "☐";
                return (
                  <li
                    key={j}
                    className={`flex items-start gap-2 rounded px-1.5 py-1 text-[11.5px] ${
                      item.checked
                        ? "text-[var(--skein-text-muted)] line-through"
                        : "text-[var(--skein-text)]"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[1px] font-mono text-[13px] text-[var(--skein-text-muted)]"
                    >
                      {glyph}
                    </span>
                    <span className="flex-1 break-words">
                      {renderInline(item.text)}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {item.energy && (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${energyChipClass(item.energy)}`}
                        >
                          {item.energy}
                        </span>
                      )}
                      {item.duration && (
                        <span className="rounded bg-[var(--skein-bg)] px-1.5 py-0.5 font-mono text-[9.5px] text-[var(--skein-text-muted)] ring-1 ring-inset ring-[var(--skein-border)]">
                          {item.duration}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {parsed.extraSections.map((s, i) => (
          <section key={`extra-${i}`} className="space-y-2">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[var(--skein-text-muted)]">
              {s.heading}
            </h2>
            {renderExtraSection(s)}
          </section>
        ))}
      </div>
    </div>
  );
}
