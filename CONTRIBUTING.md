# Contributing to Skein

Thanks for your interest in Skein. This is a small, focused project — the bar is clarity and respecting the read-only contract, not breadth of features.

## Ground rules

1. **Bun + TypeScript only.** Never `npm`, `npx`, `yarn`, or `pnpm`. Use `bun install`, `bun run <script>`, and `bunx` if you must run a one-off. No Python.
2. **Never write to PAI / Claude Code files.** Anything under `~/.claude/MEMORY/`, `~/.claude/skills/`, or Claude/PAI config is **read-only** from Skein's side. All Skein-owned state goes under `~/.claude/skein/`. The one sanctioned exception is per-session notepads written into `<session-cwd>/skein/` — keep it that way and do not add new out-of-tree writes.
3. **Reflect reality.** A card must never show a live indicator for a dead window or a fabricated session ID. Prefer the deterministic source of truth (the `~/.claude/sessions/<pid>.json` registry) over heuristics.
4. **Don't block the scan.** All LLM/inference work is fire-and-forget with capped concurrency. The capture scan must never wait on inference.

## Setup

```bash
bun install
bun run dev   # UI on :5555, API on :5556
```

- UI: Vite + React 19 + TailwindCSS v4.
- API: Hono on Bun, started from `server/index.ts`.
- On a synced filesystem (iCloud Drive), Vite polls for changes — reloads may lag slightly. This is expected (`vite.config.ts`).
- Configuration is optional — copy `.env.example` to `.env` to override scan roots (`SKEIN_SCAN_ROOTS`) or ports.

Type-check before opening a PR:

```bash
bunx tsc --noEmit
```

## Project structure

```
skein/
├── server/
│   ├── index.ts            # Hono API server (port 5556)
│   ├── coherence/          # heartbeat, thread capture, digests, titles,
│   │                       # briefing, goal-link, rhythm, notepads, vaults
│   ├── routes/             # API route handlers
│   └── lib/                # shared server helpers
├── src/
│   ├── App.tsx             # root layout
│   ├── components/         # Board, NotepadView, Sidebar, tabbed panels
│   ├── hooks/              # data-loading hooks
│   ├── lib/                # types + client helpers
│   └── styles/             # Tailwind + globals
├── scripts/                # heartbeat-cron, digest generation
└── vite.config.ts          # UI dev server + /api proxy
```

If you add a writable artifact, document it in the README's **Data Contract** table and confirm it lands under `~/.claude/skein/` (or the sanctioned `<cwd>/skein/` notepad path).

## Pull request expectations

- **One concern per PR.** Keep diffs scoped and reviewable.
- **Type-clean.** `bunx tsc --noEmit` must pass.
- **Document data changes.** New reads/writes go in the README Data Contract.
- **Preserve the invariants** above (Bun-only, read-only against PAI, reflect reality, non-blocking scan).
- **Describe how you verified.** Note what you ran and what you observed — especially for terminal-control and capture changes, which are environment-sensitive (macOS + Apple Terminal).
- **No secrets.** Never commit API keys, tokens, or personal `~/.claude/` data.

## Reporting issues

Open an issue with: what you expected, what happened, your macOS + Bun versions, and whether you run a PAI-style `~/.claude/` layout or stock Claude Code. The latter matters because several features depend on the PAI layout.
