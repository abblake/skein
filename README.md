# Skein

> A lightweight companion dashboard for Claude Code that makes it safe to close a terminal window without losing the context that was loaded into it.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## The problem

You have ten Claude Code windows open. You can't bring yourself to close any of them.

Each one is holding a thread of work — a context you built up over an hour of back-and-forth — and closing the window *feels* like throwing that context away. So they stack up. The pile becomes your working memory: a wall of half-finished terminals you're afraid to touch, with no overview of what's actually in flight, which window needs you next, or what any given session was even doing.

Here's the thing: that context isn't actually in the window. Claude Code already persists every session to disk. The window-hoarding is a workaround for missing **resume infrastructure** — not a real requirement. You're keeping windows open because nothing else makes it safe to close them.

## How Skein fixes it

Skein is the **trusted parking lot**. Park a thread and it keeps its session; pick it back up later with one click, exactly where you left off. Once resuming is reliable, closing a window stops being scary.

It runs **alongside** your native terminal — it doesn't embed or replace it. It watches the Claude Code sessions you already have open, captures each as a card you can put down and pick back up, and enriches it with an at-a-glance summary, an open-threads view, and per-session notes. At a glance you can see which windows need you, what each parked thread accomplished, and which thread is the highest-leverage one to resume next.

The result: persistent context, session coherence, and multi-project visibility — without touching your terminal.

> **Screenshot coming soon** — a dashboard screenshot will live at `docs/screenshot.png`.

## What Skein Is

- A **read-only dashboard** over your local Claude Code / `~/.claude/` data. It never modifies your sessions, memory, or PRDs.
- A **parking lot** for work threads: every live Claude Code window shows up as a card, and when you close the window the card stays — parked, resumable with one click.
- A **coherence layer**: each card carries an LLM-generated digest of what the session is doing, optional per-session notepads (real Obsidian vaults), and recency-aware sorting so the hottest thread floats to the top.

## What Skein Is NOT

- **Not a terminal emulator.** Claude Code stays native — Skein orchestrates and observes the real terminal, it does not embed one.
- **Not an agent orchestrator.** Skein watches sessions; it does not spawn or coordinate agents.
- **Not a project manager.** No tickets, no boards-as-source-of-truth. The board reflects real session state.
- **Not a replacement for Claude Code or any `~/.claude/` framework.** Skein reads that data; it does not own it.

## Requirements

| Requirement | Why |
|-------------|-----|
| **[Claude Code](https://docs.claude.com/en/docs/claude-code)** with a populated `~/.claude/` directory | Skein's entire data layer reads from here. With no `~/.claude/`, there is nothing to display. |
| **[Bun](https://bun.sh)** (latest) | Runtime for the API server and all scripts. Skein is Bun-only — never npm/npx. |
| **macOS** with **Apple Terminal** | Window focus and resume are driven by AppleScript against Terminal.app. Other terminals and OSes are not supported yet (see [Roadmap](#roadmap)). |
| A modern browser | The UI is a standard Vite/React app served on localhost. |

> **Important — the `~/.claude/` dependency.** Skein expects the directory layout that Claude Code (and, optionally, a PAI-style setup) writes under `~/.claude/`. Core features (the live/parked board, session capture, notepads) need only Claude Code's own `~/.claude/sessions/<pid>.json` registry. Some enrichment features assume a richer PAI-style layout and **degrade gracefully when it is absent** — see [Optional / PAI-dependent features](#optional--pai-dependent-features).

## Quick Start

```bash
# 1. Clone
git clone https://github.com/abblake/skein.git

cd skein

# 2. Install dependencies (Bun only)
bun install

# 3. Run the UI + API server together
bun run dev
```

This starts two processes via `concurrently`:

- **UI** (Vite) on **http://localhost:5555** — open this in your browser.
- **API server** (Hono on Bun) on **http://localhost:5556** — the UI proxies `/api` requests here.

Open <http://localhost:5555>. With Claude Code windows open, you should see them appear as cards within a scan cycle.

> **Note:** Skein lives happily on iCloud Drive, but synced filesystems break native file-watch events, so Vite is configured to **poll** for changes (see `vite.config.ts`). Expect a short delay on hot reload.

### Other scripts

```bash
bun run build            # Type-check + production build of the UI
bun run heartbeat        # Run the active-session scanner once
bun run heartbeat:daemon # Run the scanner on a loop
bun run digest           # Generate a session digest
bun run digest:all       # Generate digests for all sessions
```

## Configuration

Skein runs with sensible defaults and needs no configuration to start. To customize, copy `.env.example` to `.env` and adjust:

- **`SKEIN_SCAN_ROOTS`** — colon-separated absolute paths Skein scans for project folders with live Claude Code sessions. Defaults to your home directory.
- **`SKEIN_API_PORT`** / **`SKEIN_UI_PORT`** — override the API (5556) and UI (5555) ports.

See [`.env.example`](.env.example) for the full annotated list. All variables are optional.

## Architecture

Skein is three layers. Data flows up: Claude Code writes to `~/.claude/`, Skein reads it, the coherence engine synthesizes it, and the UI renders it.

```
┌──────────────────────────────────────────────────────────────┐
│  UI LAYER  — React 19 + Vite 6 + TailwindCSS v4  (port 5555)   │
│  Board · Notepad · Briefing · Threads · Sidebar · StatusBar    │
└──────────────────────────────────────────────────────────────┘
                              ▲  /api (proxied)
┌──────────────────────────────────────────────────────────────┐
│  COHERENCE ENGINE  — Hono on Bun  (port 5556)                  │
│  heartbeat scanner · thread capture · digests · session        │
│  titles · briefing · goal-link · rhythm · notepads             │
└──────────────────────────────────────────────────────────────┘
                              ▲  read-only
┌──────────────────────────────────────────────────────────────┐
│  DATA LAYER  — ~/.claude/  (Claude Code / PAI persistence)     │
│  sessions/<pid>.json registry · MEMORY/STATE · MEMORY/WORK     │
└──────────────────────────────────────────────────────────────┘
```

**1. Data layer (read-only).** Skein reads Claude Code's live `~/.claude/sessions/<pid>.json` registry to map each running `claude` process to its current session ID — the deterministic source of truth for "which window is which." It also reads PAI/Claude memory files (`~/.claude/MEMORY/...`) where present for titles, tasks, and reflections.

**2. Coherence engine (Hono on Bun).** A heartbeat scanner detects active sessions, captures each as a thread, and fires fire-and-forget LLM calls (capped concurrency) to generate digests and 3–6 word session titles. It also synthesizes a focus-coach briefing, infers a goal per project, detects work rhythms, and manages per-session notepads. All LLM calls route through a PAI inference tool rather than a direct SDK; see [Optional / PAI-dependent features](#optional--pai-dependent-features).

**3. UI layer (React + Vite + Tailwind).** A parking-lot board of thread cards (live / parked / waiting / done columns, drag to file), a Notepad view of per-session scratchpads, and supporting tabs. Sorting is recency-aware so the most recently active thread surfaces first.

### Key paths

- `server/index.ts` — Hono API server (port 5556)
- `server/coherence/` — heartbeat, thread capture, digests, titles, briefing, notepads
- `src/App.tsx` — root layout
- `src/components/` — Board, NotepadView, Sidebar, and tabbed panels
- `scripts/heartbeat-cron.ts` — standalone scanner for cron/daemon use

## Data Contract

Skein strictly separates what it **reads** (other tools own these — never written by Skein) from what it **writes** (Skein owns these).

### Skein READS (read-only — never modified)

| Path | Purpose |
|------|---------|
| `~/.claude/sessions/<pid>.json` | Live session registry — maps a running `claude` process to its session ID. Deterministic identity. |
| `~/.claude/MEMORY/STATE/work.json` | Session registry: task, phase, progress, criteria. |
| `~/.claude/MEMORY/WORK/*/PRD.md` | Per-task PRDs (frontmatter + body). |
| `~/.claude/MEMORY/STATE/session-names.json` | Session UUID → display name. |
| `~/.claude/MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl` | Session reflections / learnings. |
| `~/.claude/projects/<slug>/` | Claude Code transcript folders (used to resolve titles). |

### Skein WRITES (Skein-owned)

All Skein state lives under `~/.claude/skein/`:

| Path | Purpose |
|------|---------|
| `~/.claude/skein/threads.json` | Thread cards — the capture spine (column placement, digest, goal). |
| `~/.claude/skein/live-state.json` | Heartbeat scanner output. |
| `~/.claude/skein/session-titles.json` | LLM-generated session titles, keyed by session ID. |
| `~/.claude/skein/project-goals.json` | Inferred project → goal cache. |
| `~/.claude/skein/briefing.json` | Cached focus-coach briefing. |
| `~/.claude/skein/resume-log.jsonl` | Append-only open/resume log (rhythm signal). |
| `~/.claude/skein/harvests/*.md` | Harvested skill docs (you promote these manually). |
| `~/.claude/skein/digests/`, `narratives/`, `threads/` | Per-project digests and narratives. |

**One sanctioned exception to "all writes go under `~/.claude/skein/`":** per-session notepads are written **into the session's own working directory** at `<session-cwd>/skein/notepad/<sessionId>.md`. The `<cwd>/skein/` folder is a ready-to-open Obsidian vault, git-ignored via its own `.gitignore`. Notes live next to the project they describe. When a cwd is unknown or unwritable, notepads fall back to `~/.claude/skein/notepads/`.

> **The golden rule:** Skein never writes to a path owned by Claude Code or PAI (anything under `~/.claude/MEMORY/`, skills, or config). If you contribute, preserve this invariant.

## Optional AI features

Skein is a companion to a **PAI-style `~/.claude/` layout** — a personal framework that stores your Claude memory, work state, and an inference tool under `~/.claude/`. The optional AI features route LLM calls through that tool at `~/.claude/PAI/TOOLS/Inference.ts` rather than a direct API SDK.

**Without that tool (a non-PAI / stock Claude Code user), Skein runs fully — minus the AI features, which skip cleanly.** The core experience is unaffected: the live/parked board, session capture, resume/focus, recency sorting, and per-session notepads all work with only Claude Code's own `~/.claude/sessions/<pid>.json` registry and your transcript folders.

The features that require the Inference tool, and degrade gracefully when it is absent:

- **Session digests** — a short LLM summary of what each session is doing. Without the tool, cards appear without a digest.
- **Session titles** — a 3–6 word title per session. Without the tool, the card falls back to its tty/pid label.
- **Focus-coach briefing** — a synthesized "start here" briefing across threads. Skipped without the tool.
- **TELOS goal chips** — an inferred life-goal chip (e.g. `G##`) per project, read from a PAI `TELOS` structure. No chip is shown without it.

## Limitations

- **macOS + Apple Terminal only.** Window focus and resume use AppleScript against Terminal.app. iTerm, Ghostty, Linux, and Windows are not supported (see [Roadmap](#roadmap)).
- **Local-only.** Skein reads your local `~/.claude/` and serves on localhost. There is no remote/multi-machine mode.
- **Keyword search only.** Card search matches title/digest/project/goal text; semantic/vector search is not implemented.
- **Synced-filesystem caveat.** On iCloud Drive (or similar), native file events are unreliable, so the dev server polls — expect slightly delayed reloads.
- **Pre-1.0.** Version `0.1.0`. APIs, file formats, and the UI may change.

## Roadmap

- **Cross-platform terminal support** — focus/resume beyond macOS Apple Terminal (iTerm, Ghostty, and Linux/Windows terminals).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: Bun + TypeScript only (never npm/npx), `bun run dev` to develop, and never write to PAI-owned files.

## License

[MIT](LICENSE) © Andrew Blake
