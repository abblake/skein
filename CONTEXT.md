# CONTEXT — Skein Ubiquitous Language

> Glossary of domain terms for Skein. What each term IS, not how it's implemented.
> Defends plans against drift. Add only domain-specific terms, never general programming concepts.

## Recency / "most recently active"

The single time axis Skein sorts session lists by. It resolves to a **different source per state**, but all are comparable as "last real activity":

- **Live window** → the session registry's `updatedAt` (`~/.claude/sessions/<pid>.json`) — last tool/message activity. The deterministic source of truth (beats cwd+recency guessing).
- **Parked thread** → `lastActiveAt` (last transcript activity), since a parked thread has no live registry entry.
- **Notepad list** → reacts to the underlying **Claude session's** activity (registry `updatedAt`), **not** to the user typing a note. The list answers "which thread is hot," so editing a note must not bump its row.

_Avoid_: "last updated" (ambiguous — could mean note-edit time), "last opened" (that's a resume event, a different signal — see `resume-log.jsonl`).

## Thread / Card / Session / Project (existing — from ISA)

- **Thread** = a resumable Claude session. The unit Skein captures and parks. Keyed `win-<sessionId>`.
- **Card** = the UI representation of a thread on the Parking Lot board. Card = thread, **not** project.
- **Project** = a *lane*, not a card — the cwd/folder a thread runs in. Multiple threads share one project.
- **Session** = used interchangeably with thread in the Notepad surface ("Open Sessions"), keyed by stable `sessionId` (survives `--resume`).
