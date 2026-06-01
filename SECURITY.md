# Security Policy

## Scope

Skein is a **local-only** dashboard. It binds its API server to `127.0.0.1`, serves
the UI on localhost, and is intended to run on your own machine against your own
`~/.claude/` directory. It is not designed to be exposed to a network or run as a
multi-user service.

## What Skein reads

Skein reads private local data, so handle it accordingly:

- It reads (read-only) from `~/.claude/` — your Claude Code session registry, and,
  where present, PAI-style memory, work state, and transcripts.
- Optional integrations may read tokens that already exist on your machine
  (for example, the optional Todoist feature reads a token from `~/.claude.json`
  if one is configured). Skein never transmits these anywhere except to the
  upstream service the feature talks to, and never writes them to disk itself.

Because Skein surfaces the contents of your local sessions, treat the dashboard
the way you treat your terminal: anyone with access to it can see what your
Claude Code sessions are doing.

## Reporting a vulnerability

If you find a security issue, **please do not open a public issue.** Instead,
report it privately to the maintainer:

- Use GitHub's **[Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)**
  on this repository ("Security" tab → "Report a vulnerability"), or
- Contact the maintainer directly via the email on their GitHub profile.

Please include what you observed, how to reproduce it, and the impact you believe
it has. You can expect an acknowledgment within a reasonable timeframe; this is a
small project maintained on a best-effort basis.

## Supported versions

Skein is pre-1.0 (`0.x`). Only the latest release receives security fixes.
