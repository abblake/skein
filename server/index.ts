import { Hono } from "hono";
import { cors } from "hono/cors";
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import matter from "gray-matter";
import { assertSafeSegment, validateNotepadDir } from "./coherence/path-guards";

const app = new Hono();
// Skein serves the running user's private ~/.claude data with no auth, so the
// API must only answer the local UI. Restrict CORS to the Vite dev origin; the
// Vite proxy talks to :5556 server-to-server and is unaffected by CORS.
app.use("*", cors({ origin: "http://localhost:5555" }));

const CLAUDE_DIR = join(homedir(), ".claude");
const MEMORY_DIR = join(CLAUDE_DIR, "MEMORY");
const SKEIN_DIR = join(CLAUDE_DIR, "skein");

/** Parse PRD markdown body into sections */
function parsePrdSections(content: string) {
  const sections: Record<string, string> = {};
  const lines = content.split("\n");
  let currentSection = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    const sectionMatch = line.match(/^## (.+)$/);
    if (sectionMatch) {
      if (currentSection) {
        sections[currentSection] = currentContent.join("\n").trim();
      }
      currentSection = sectionMatch[1].toLowerCase();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }
  if (currentSection) {
    sections[currentSection] = currentContent.join("\n").trim();
  }
  return sections;
}

/** Parse criteria checkboxes from criteria section */
function parseCriteria(criteriaText: string) {
  if (!criteriaText) return [];
  return criteriaText
    .split("\n")
    .filter((line) => line.match(/^- \[[ x]\]/))
    .map((line) => {
      const checked = line.startsWith("- [x]");
      const text = line.replace(/^- \[[ x]\]\s*/, "").trim();
      const idMatch = text.match(/^(ISC-A?-?\d+):\s*/);
      return {
        id: idMatch ? idMatch[1] : "",
        description: idMatch ? text.replace(idMatch[0], "") : text,
        checked,
      };
    });
}

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

// Parking Lot: capture live sessions into thread cards and return the store.
app.get("/api/threads", async (c) => {
  try {
    const { captureThreads } = await import("./coherence/thread-capture");
    return c.json(await captureThreads());
  } catch (err: any) {
    return c.json({ error: err.message, lastScan: null, cards: [] }, 500);
  }
});

// Parking Lot: focus-coach briefing over all threads (cached, regen on demand).
app.get("/api/threads/briefing", async (c) => {
  try {
    const { getBriefing } = await import("./coherence/briefing");
    return c.json(await getBriefing(c.req.query("force") === "1"));
  } catch (err: any) {
    return c.json({ text: "Briefing error: " + err.message, generatedAt: null }, 500);
  }
});

// Parking Lot: harvest a thread into a reusable skill doc (Skein-owned harvests/).
app.post("/api/thread/:id/harvest", async (c) => {
  const id = c.req.param("id");
  try {
    const raw = await readFile(join(SKEIN_DIR, "threads.json"), "utf-8");
    const card = JSON.parse(raw).cards?.find((t: any) => t.id === id);
    if (!card) return c.json({ ok: false, detail: "unknown thread" }, 404);
    const { harvestThread } = await import("./coherence/harvest");
    return c.json(await harvestThread(card));
  } catch (err: any) {
    return c.json({ ok: false, detail: err.message }, 500);
  }
});

// === HARVEST VIEWER ===

// List all harvest docs (Skein-owned), newest first.
app.get("/api/harvests", async (c) => {
  try {
    const { listHarvests } = await import("./coherence/harvests");
    return c.json(await listHarvests());
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Read one harvest doc's markdown. :file is guarded against traversal.
app.get("/api/harvest/:file", async (c) => {
  let file: string;
  try {
    file = assertSafeSegment(c.req.param("file"));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  try {
    const { readHarvest } = await import("./coherence/harvests");
    const doc = await readHarvest(file);
    if (!doc) return c.notFound();
    return c.json(doc);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Surface-only promote: reveal the harvests folder in Finder so the user can
// move/open a doc themselves. Skein NEVER writes to a PAI path — the actual
// PAI-skill authoring happens in a Claude session. Body: { file? } (optional;
// when present it's validated, but we open the dir regardless).
app.post("/api/harvest/reveal", async (c) => {
  const { file: rawFile } = await c.req.json().catch(() => ({ file: null }));
  if (rawFile != null) {
    try {
      assertSafeSegment(String(rawFile));
    } catch (err: any) {
      return c.json({ ok: false, detail: err.message }, 400);
    }
  }
  try {
    const { execFile } = await import("child_process");
    const { HARVEST_DIR } = await import("./coherence/harvests");
    execFile("open", [HARVEST_DIR]); // macOS Finder; fire-and-forget
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ ok: false, detail: err.message }, 500);
  }
});

// Parking Lot: manually place a thread in a column (drag). waiting/done = sticky.
app.post("/api/thread/:id/column", async (c) => {
  const id = c.req.param("id");
  const { column } = await c.req.json().catch(() => ({ column: null }));
  const valid = ["live", "parked", "waiting", "done"];
  if (!valid.includes(column)) return c.json({ ok: false, detail: "invalid column" }, 400);
  try {
    const { setThreadColumn } = await import("./coherence/thread-capture");
    const card = await setThreadColumn(id, column);
    if (!card) return c.json({ ok: false, detail: "unknown thread" }, 404);
    return c.json({ ok: true, card });
  } catch (err: any) {
    return c.json({ ok: false, detail: err.message }, 500);
  }
});

// Parking Lot: open a thread — focus its live window, or resume the closed session.
// The card is looked up server-side; dir/tty/uuid never come from the client body.
app.post("/api/thread/:id/open", async (c) => {
  const id = c.req.param("id");
  try {
    const { captureThreads } = await import("./coherence/thread-capture");
    const { focusWindowByTty, resumeSession } = await import("./coherence/terminal-control");
    const store = await captureThreads(); // freshest live/parked truth
    const card = store.cards.find((t) => t.id === id);
    if (!card) return c.json({ ok: false, action: "none", detail: "unknown thread" }, 404);

    // Log the open — the long-term "I keep coming back here" rhythm signal.
    import("./coherence/rhythm").then((m) =>
      m.logOpen(card.projectId, card.uuid, card.live ? "focus" : "resume"),
    );

    if (card.live && card.tty) {
      const r = await focusWindowByTty(card.tty);
      // If the window vanished between scans, fall back to resume.
      if (!r.ok) {
        const rr = await resumeSession(card.projectDir, card.uuid);
        return c.json({ ok: rr.ok, action: "resume", detail: rr.detail });
      }
      return c.json({ ok: r.ok, action: "focus", detail: r.detail });
    }

    const r = await resumeSession(card.projectDir, card.uuid);
    return c.json({ ok: r.ok, action: "resume", detail: r.detail });
  } catch (err: any) {
    return c.json({ ok: false, action: "error", detail: err.message }, 500);
  }
});

// Get work.json — all tracked sessions
app.get("/api/work", async (c) => {
  try {
    const raw = await readFile(
      join(MEMORY_DIR, "STATE", "work.json"),
      "utf-8"
    );
    return c.json(JSON.parse(raw));
  } catch {
    return c.json({ sessions: {} });
  }
});

// List all PRD directories with frontmatter
app.get("/api/prds", async (c) => {
  try {
    const dirs = await readdir(join(MEMORY_DIR, "WORK"));
    const prds = await Promise.all(
      dirs.map(async (slug) => {
        try {
          const prdPath = join(MEMORY_DIR, "WORK", slug, "PRD.md");
          const raw = await readFile(prdPath, "utf-8");
          const { data } = matter(raw);
          const stats = await stat(prdPath);
          return { slug, mtime: stats.mtimeMs, ...data };
        } catch {
          return null;
        }
      })
    );
    // Sort by most recent first
    return c.json(
      prds
        .filter(Boolean)
        .sort((a: any, b: any) => (b.mtime ?? 0) - (a.mtime ?? 0))
    );
  } catch {
    return c.json([]);
  }
});

// Search PRDs by keyword (matches against task name and slug)
app.get("/api/prds/search", async (c) => {
  const query = (c.req.query("q") ?? "").toLowerCase();
  if (!query) return c.json([]);

  // Split query into keywords for fuzzy matching
  const keywords = query
    .replace(/[_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  try {
    const dirs = await readdir(join(MEMORY_DIR, "WORK"));
    const matches = await Promise.all(
      dirs.map(async (slug) => {
        try {
          const prdPath = join(MEMORY_DIR, "WORK", slug, "PRD.md");
          const raw = await readFile(prdPath, "utf-8");
          const { data, content } = matter(raw);
          const task = ((data.task as string) ?? "").toLowerCase();
          const slugLower = slug.toLowerCase();
          const contentLower = content.toLowerCase().slice(0, 500);

          // Score: how many keywords match
          const score = keywords.reduce((acc, kw) => {
            if (task.includes(kw)) return acc + 3;
            if (slugLower.includes(kw)) return acc + 2;
            if (contentLower.includes(kw)) return acc + 1;
            return acc;
          }, 0);

          if (score === 0) return null;

          const stats = await stat(prdPath);
          const sections = parsePrdSections(content);
          const criteria = parseCriteria(sections.criteria || "");

          return {
            slug,
            score,
            mtime: stats.mtimeMs,
            ...data,
            context: (sections.context ?? "").slice(0, 300),
            criteriaCount: criteria.length,
            criteriaPassed: criteria.filter((cr) => cr.checked).length,
          };
        } catch {
          return null;
        }
      })
    );

    return c.json(
      matches
        .filter(Boolean)
        .sort((a: any, b: any) => b.score - a.score || b.mtime - a.mtime)
        .slice(0, 10)
    );
  } catch {
    return c.json([]);
  }
});

// Get a specific PRD with parsed sections
app.get("/api/prds/:slug", async (c) => {
  let slug: string;
  try {
    slug = assertSafeSegment(c.req.param("slug"));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  try {
    const raw = await readFile(
      join(MEMORY_DIR, "WORK", slug, "PRD.md"),
      "utf-8"
    );
    const { data, content } = matter(raw);
    const sections = parsePrdSections(content);
    const criteria = parseCriteria(sections.criteria || "");
    return c.json({
      frontmatter: data,
      sections,
      criteria,
      raw: content,
    });
  } catch {
    return c.notFound();
  }
});

// Get session names
app.get("/api/session-names", async (c) => {
  try {
    const raw = await readFile(
      join(MEMORY_DIR, "STATE", "session-names.json"),
      "utf-8"
    );
    return c.json(JSON.parse(raw));
  } catch {
    return c.json({});
  }
});

// Get algorithm reflections
app.get("/api/reflections", async (c) => {
  try {
    const raw = await readFile(
      join(
        MEMORY_DIR,
        "LEARNING",
        "REFLECTIONS",
        "algorithm-reflections.jsonl"
      ),
      "utf-8"
    );
    const lines = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return c.json(lines);
  } catch {
    return c.json([]);
  }
});

// === DIGEST ENDPOINTS ===

// List all digests across all sessions, sorted by date
app.get("/api/digests", async (c) => {
  try {
    const digestsDir = join(SKEIN_DIR, "digests");
    const slugDirs = await readdir(digestsDir).catch(() => []);
    const allDigests: Record<string, any>[] = [];

    for (const slug of slugDirs) {
      try {
        const files = await readdir(join(digestsDir, slug));
        for (const file of files.filter((f) => f.endsWith(".md"))) {
          const raw = await readFile(join(digestsDir, slug, file), "utf-8");
          const { data, content } = matter(raw);
          const sections = parsePrdSections(content);
          allDigests.push({
            slug,
            file,
            ...(data as Record<string, any>),
            explored: sections["what was explored"] ?? "",
            discovered: sections["what was discovered"] ?? "",
            decided: sections["what was decided"] ?? "",
            openThreads: sections["open threads"] ?? "",
          });
        }
      } catch {
        // skip bad directories
      }
    }

    // Sort newest first
    allDigests.sort(
      (a, b) =>
        new Date(b.timestamp ?? 0).getTime() -
        new Date(a.timestamp ?? 0).getTime()
    );

    return c.json(allDigests);
  } catch {
    return c.json([]);
  }
});

// Get digests for a specific session
app.get("/api/digests/:slug", async (c) => {
  let slug: string;
  try {
    slug = assertSafeSegment(c.req.param("slug"));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  try {
    const digestDir = join(SKEIN_DIR, "digests", slug);
    const files = await readdir(digestDir);
    const digests: Record<string, any>[] = [];

    for (const file of files.filter((f) => f.endsWith(".md"))) {
      const raw = await readFile(join(digestDir, file), "utf-8");
      const { data, content } = matter(raw);
      const sections = parsePrdSections(content);
      digests.push({
        file,
        ...(data as Record<string, any>),
        explored: sections["what was explored"] ?? "",
        discovered: sections["what was discovered"] ?? "",
        decided: sections["what was decided"] ?? "",
        openThreads: sections["open threads"] ?? "",
      });
    }

    return c.json(digests);
  } catch {
    return c.json([]);
  }
});

// Generate a digest for a specific session (POST)
app.post("/api/digests/generate/:slug", async (c) => {
  let slug: string;
  try {
    slug = assertSafeSegment(c.req.param("slug"));
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
  try {
    const { generateDigest } = await import("./coherence/digest-generator");
    const path = await generateDigest(slug);
    return c.json({ success: true, path });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// === BRIEFING ENDPOINTS ===

// Get cached briefing for a session
app.get("/api/briefing/:slug", async (c) => {
  let slug: string;
  try {
    slug = assertSafeSegment(c.req.param("slug"));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  try {
    const { loadBriefing } = await import("./coherence/briefing-generator");
    const briefing = await loadBriefing(slug);
    if (briefing) return c.json(briefing);
    return c.json(null);
  } catch {
    return c.json(null);
  }
});

// Generate a new briefing for a session
app.post("/api/briefing/generate/:slug", async (c) => {
  let slug: string;
  try {
    slug = assertSafeSegment(c.req.param("slug"));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  try {
    const { generateBriefing } = await import("./coherence/briefing-generator");
    const briefing = await generateBriefing(slug);
    return c.json(briefing);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// === THREAD ENDPOINTS ===

// Get threads for a specific session (extracted from digests)
app.get("/api/threads/:slug", async (c) => {
  let slug: string;
  try {
    slug = assertSafeSegment(c.req.param("slug"));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  try {
    const { extractThreadsForSession, markStaleThreads } = await import(
      "./coherence/thread-extractor"
    );
    const threads = await extractThreadsForSession(slug);
    return c.json(markStaleThreads(threads));
  } catch {
    return c.json([]);
  }
});

// Get ALL threads across all sessions
app.get("/api/threads", async (c) => {
  try {
    const { extractAllThreads, markStaleThreads } = await import(
      "./coherence/thread-extractor"
    );
    const threads = await extractAllThreads();
    return c.json(markStaleThreads(threads));
  } catch {
    return c.json([]);
  }
});

// === NARRATIVE ENDPOINTS ===

// Get narrative for a session
app.get("/api/narrative/:slug", async (c) => {
  let slug: string;
  try {
    slug = assertSafeSegment(c.req.param("slug"));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  try {
    const { loadNarrative } = await import("./coherence/narrative-synth");
    const narrative = await loadNarrative(slug);
    return c.json({ narrative: narrative ?? null });
  } catch {
    return c.json({ narrative: null });
  }
});

// Generate/update narrative for a session
app.post("/api/narrative/generate/:slug", async (c) => {
  let slug: string;
  try {
    slug = assertSafeSegment(c.req.param("slug"));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  try {
    const { synthesizeNarrative } = await import("./coherence/narrative-synth");
    const narrative = await synthesizeNarrative(slug);
    return c.json({ narrative });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// === PROJECT COHERENCE (JSONL-based briefings and narratives) ===

// Get project briefing (cached)
app.get("/api/project-briefing/:claudeProjectId", async (c) => {
  let id: string;
  try {
    id = assertSafeSegment(c.req.param("claudeProjectId"));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  try {
    const { loadProjectBriefing } = await import("./coherence/project-coherence");
    const briefing = await loadProjectBriefing(id);
    return c.json(briefing);
  } catch {
    return c.json(null);
  }
});

// Generate project briefing from JSONL sessions
app.post("/api/project-briefing/:claudeProjectId", async (c) => {
  let id: string;
  try {
    id = assertSafeSegment(c.req.param("claudeProjectId"));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  const name = c.req.query("name") ?? id;
  try {
    const { generateProjectBriefing } = await import("./coherence/project-coherence");
    const briefing = await generateProjectBriefing(id, name);
    return c.json(briefing);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Get project narrative (cached)
app.get("/api/project-narrative/:claudeProjectId", async (c) => {
  let id: string;
  try {
    id = assertSafeSegment(c.req.param("claudeProjectId"));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  try {
    const { loadProjectNarrative } = await import("./coherence/project-coherence");
    const narrative = await loadProjectNarrative(id);
    return c.json(narrative);
  } catch {
    return c.json(null);
  }
});

// Generate project narrative from JSONL sessions
app.post("/api/project-narrative/:claudeProjectId", async (c) => {
  let id: string;
  try {
    id = assertSafeSegment(c.req.param("claudeProjectId"));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  const name = c.req.query("name") ?? id;
  try {
    const { generateProjectNarrative } = await import("./coherence/project-coherence");
    const narrative = await generateProjectNarrative(id, name);
    return c.json(narrative);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// === SESSION READER (reads actual Claude conversation logs) ===

// Get all project summaries from real Claude session data
app.get("/api/sessions/projects", async (c) => {
  try {
    const { getAllProjectSummaries } = await import(
      "./coherence/session-reader"
    );
    const summaries = await getAllProjectSummaries();
    return c.json(summaries);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Get recent sessions for a specific project
app.get("/api/sessions/:projectId", async (c) => {
  let projectId: string;
  try {
    projectId = assertSafeSegment(c.req.param("projectId"));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  const limit = parseInt(c.req.query("limit") ?? "10", 10);
  try {
    const { getProjectSessions } = await import("./coherence/session-reader");
    const sessions = await getProjectSessions(projectId, limit);
    return c.json(sessions);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// === PROJECT SCANNER ===

// Get full project list (merges active sessions + .claude dirs + PRDs)
app.get("/api/projects/scan", async (c) => {
  try {
    const { scanProjects } = await import("./coherence/project-scanner");
    const projects = await scanProjects();
    return c.json(projects);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// === HEARTBEAT ENDPOINTS ===

// Trigger a heartbeat scan
app.post("/api/heartbeat/scan", async (c) => {
  try {
    const { scanActiveSessions } = await import("./coherence/heartbeat");
    const state = await scanActiveSessions();
    return c.json(state);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Get live state (also triggers a fresh scan if stale > 5 min)
app.get("/api/live-state", async (c) => {
  try {
    const raw = await readFile(join(SKEIN_DIR, "live-state.json"), "utf-8");
    const state = JSON.parse(raw);

    // If stale (> 5 minutes old), trigger a fresh scan
    const lastScan = new Date(state.lastScan).getTime();
    const now = Date.now();
    if (now - lastScan > 5 * 60 * 1000) {
      const { scanActiveSessions } = await import("./coherence/heartbeat");
      const freshState = await scanActiveSessions();
      return c.json(freshState);
    }

    return c.json(state);
  } catch {
    // No live-state.json yet — do a fresh scan
    try {
      const { scanActiveSessions } = await import("./coherence/heartbeat");
      const freshState = await scanActiveSessions();
      return c.json(freshState);
    } catch {
      return c.json({ lastScan: null, activeSessions: [], projectSummary: {} });
    }
  }
});

// Get project registry (Skein-owned)
app.get("/api/projects", async (c) => {
  try {
    const raw = await readFile(join(SKEIN_DIR, "projects.json"), "utf-8");
    return c.json(JSON.parse(raw));
  } catch {
    return c.json({ projects: [] });
  }
});

// (live-state endpoint is now in HEARTBEAT ENDPOINTS section above)

// === TODOIST LIVE FETCH ===

app.get("/api/todoist/project/:id", async (c) => {
  const projectId = c.req.param("id");
  const refresh = c.req.query("refresh") === "1";
  const { getProjectTasks, TodoistProxyError } = await import(
    "./coherence/todoist-proxy"
  );
  try {
    const snapshot = await getProjectTasks(projectId, refresh);
    return c.json(snapshot);
  } catch (err) {
    if (err instanceof TodoistProxyError) {
      return c.json({ error: err.message }, err.status as 502 | 503);
    }
    return c.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      500
    );
  }
});

// === ADHD PLAN / PROJECT LINKS ENDPOINTS ===

// Get project-links.json — research-project → sessions/Todoist map from /adhd-plan
app.get("/api/project-links", async (c) => {
  try {
    const raw = await readFile(join(SKEIN_DIR, "project-links.json"), "utf-8");
    return c.json(JSON.parse(raw));
  } catch {
    return c.json({});
  }
});

// Get enriched project-link entry: Telos section + sessions + latest plan markdown
app.get("/api/project-links/:project", async (c) => {
  let project: string;
  try {
    project = assertSafeSegment(decodeURIComponent(c.req.param("project")));
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  try {
    const linksRaw = await readFile(join(SKEIN_DIR, "project-links.json"), "utf-8");
    const links = JSON.parse(linksRaw) as Record<string, any>;
    const entry = links[project];
    if (!entry) return c.notFound();

    // Extract this project's Telos block from PROJECTS.md
    let telosBlock = "";
    try {
      const telos = await readFile(
        join(CLAUDE_DIR, "PAI/USER/TELOS/PROJECTS.md"),
        "utf-8"
      );
      const lines = telos.split("\n");
      const re = new RegExp(
        `^## ${project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`
      );
      let start = -1;
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          start = i;
          break;
        }
      }
      if (start !== -1) {
        let end = lines.length;
        for (let i = start + 1; i < lines.length; i++) {
          if (/^## /.test(lines[i])) {
            end = i;
            break;
          }
        }
        telosBlock = lines.slice(start, end).join("\n").trim();
      }
    } catch {
      // Telos read failure is non-fatal
    }

    // Load the most recent plan markdown
    let latestPlan = "";
    let latestSession: any = null;
    if (Array.isArray(entry.sessions) && entry.sessions.length > 0) {
      const sorted = [...entry.sessions].sort(
        (a: any, b: any) =>
          new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      latestSession = sorted[0];
      try {
        latestPlan = await readFile(latestSession.planPath, "utf-8");
      } catch {
        latestPlan = `*(plan file not readable: ${latestSession.planPath})*`;
      }
    }

    // Extract Working directory line from the telosBlock
    let workingDir = "";
    if (telosBlock) {
      const wdMatch = telosBlock.match(
        /^\s*-\s+\*\*Working directory\*\*:\s*`?([^`\n]+?)`?\s*$/m
      );
      if (wdMatch) workingDir = wdMatch[1].trim();
    }

    return c.json({
      project,
      entry,
      telosBlock,
      workingDir,
      latestSession,
      latestPlan,
    });
  } catch {
    return c.notFound();
  }
});

// === SESSION NOTEPADS ===

// Read a session's scratchpad from its cwd vault. ?dir=<cwd>&key=<sessionId>
app.get("/api/notepad", async (c) => {
  const key = c.req.query("key");
  const rawDir = c.req.query("dir") || null;
  if (!key) return c.json({ error: "missing key" }, 400);
  let dir: string | null = null;
  if (rawDir !== null) {
    try {
      dir = await validateNotepadDir(rawDir);
    } catch (err: any) {
      return c.json({ error: err.message }, 400);
    }
  }
  try {
    const { loadNotepad } = await import("./coherence/notepads");
    return c.json(await loadNotepad(dir, key));
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Auto-save a session's scratchpad into its cwd vault. Body: { dir, key, content }
app.post("/api/notepad/save", async (c) => {
  const { dir: rawDir, key, content } = await c.req
    .json()
    .catch(() => ({ dir: null, key: null, content: "" }));
  if (!key) return c.json({ ok: false, detail: "missing key" }, 400);
  let dir: string | null = null;
  if (rawDir != null) {
    try {
      dir = await validateNotepadDir(rawDir);
    } catch (err: any) {
      return c.json({ ok: false, detail: err.message }, 400);
    }
  }
  try {
    const { saveNotepad } = await import("./coherence/notepads");
    const saved = await saveNotepad(dir, key, content ?? "");
    return c.json({ ok: true, ...saved });
  } catch (err: any) {
    return c.json({ ok: false, detail: err.message }, 500);
  }
});

// Append one server-timestamped log entry. Body: { dir, key, body }
app.post("/api/notepad/log", async (c) => {
  const { dir: rawDir, key, body } = await c.req
    .json()
    .catch(() => ({ dir: null, key: null, body: "" }));
  if (!key) return c.json({ ok: false, detail: "missing key" }, 400);
  if (!body || !String(body).trim()) return c.json({ ok: false, detail: "empty body" }, 400);
  let dir: string | null = null;
  if (rawDir != null) {
    try {
      dir = await validateNotepadDir(rawDir);
    } catch (err: any) {
      return c.json({ ok: false, detail: err.message }, 400);
    }
  }
  try {
    const { appendLogEntry } = await import("./coherence/notepads");
    const saved = await appendLogEntry(dir, key, String(body));
    return c.json({ ok: true, ...saved });
  } catch (err: any) {
    return c.json({ ok: false, detail: err.message }, 500);
  }
});

// Prepare a vault to open in Obsidian: ensure folder, register, ensure file.
// Body: { dir, key } → { ok, vaultId, rel, location } for an obsidian:// URI.
app.post("/api/notepad/open", async (c) => {
  const { dir: rawDir, key } = await c.req.json().catch(() => ({ dir: null, key: null }));
  if (!rawDir || !key) return c.json({ ok: false, detail: "missing dir or key" }, 400);
  let dir: string;
  try {
    dir = await validateNotepadDir(rawDir);
  } catch (err: any) {
    return c.json({ ok: false, detail: err.message }, 400);
  }
  try {
    const { prepareVaultForOpen } = await import("./coherence/notepads");
    const info = await prepareVaultForOpen(dir, key);
    return c.json({ ok: true, ...info });
  } catch (err: any) {
    return c.json({ ok: false, detail: err.message }, 500);
  }
});

// Reveal a session's vault folder in Finder (guaranteed fallback). Body: { dir }
app.post("/api/notepad/reveal", async (c) => {
  const { dir: rawDir } = await c.req.json().catch(() => ({ dir: null }));
  if (!rawDir) return c.json({ ok: false, detail: "missing dir" }, 400);
  let dir: string;
  try {
    dir = await validateNotepadDir(rawDir);
  } catch (err: any) {
    return c.json({ ok: false, detail: err.message }, 400);
  }
  try {
    const { execFile } = await import("child_process");
    const { join } = await import("path");
    execFile("open", [join(dir, "skein")]); // macOS Finder; fire-and-forget
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ ok: false, detail: err.message }, 500);
  }
});

// Haiku-generated session titles (#32), keyed by sessionId.
app.get("/api/session-titles", async (c) => {
  try {
    const { getTitles } = await import("./coherence/session-titles");
    return c.json(await getTitles());
  } catch {
    return c.json({});
  }
});

// Keys with notes for one cwd vault (for list badges). ?dir=<cwd>
app.get("/api/notepad/keys", async (c) => {
  const rawDir = c.req.query("dir");
  if (!rawDir) return c.json({});
  let dir: string;
  try {
    dir = await validateNotepadDir(rawDir);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  try {
    const { listNotepadKeysForDir } = await import("./coherence/notepads");
    return c.json(await listNotepadKeysForDir(dir));
  } catch {
    return c.json({});
  }
});

// Start server
const port = 5556;
console.log(`Skein API server running on http://localhost:${port}`);

export default {
  port,
  // Loopback-only: never reachable from other hosts on a shared/hostile LAN.
  hostname: "127.0.0.1",
  fetch: app.fetch,
  idleTimeout: 120, // 2 minutes — needed for AI generation endpoints
};
