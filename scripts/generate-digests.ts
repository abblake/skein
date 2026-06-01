#!/usr/bin/env bun
/**
 * Batch generate digests for recent PRDs.
 *
 * Usage:
 *   bun scripts/generate-digests.ts           # Generate for 10 most recent
 *   bun scripts/generate-digests.ts --all     # Generate for all PRDs
 *   bun scripts/generate-digests.ts --count 5 # Generate for 5 most recent
 *   bun scripts/generate-digests.ts --slug <slug>  # Generate for a specific PRD
 */

import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import matter from "gray-matter";
import { batchGenerateDigests, generateDigest } from "../server/coherence/digest-generator";

const MEMORY_WORK = join(homedir(), ".claude", "MEMORY", "WORK");

async function main() {
  const args = process.argv.slice(2);

  // Single slug mode
  const slugIdx = args.indexOf("--slug");
  if (slugIdx !== -1 && args[slugIdx + 1]) {
    const slug = args[slugIdx + 1];
    console.log(`Generating digest for: ${slug}`);
    try {
      const path = await generateDigest(slug);
      console.log(`  Done: ${path}`);
    } catch (err: any) {
      console.error(`  Error: ${err.message}`);
    }
    return;
  }

  // Determine count
  let count = 10;
  if (args.includes("--all")) count = Infinity;
  const countIdx = args.indexOf("--count");
  if (countIdx !== -1 && args[countIdx + 1]) {
    count = parseInt(args[countIdx + 1], 10);
  }

  // Get all PRDs sorted by most recent
  const dirs = await readdir(MEMORY_WORK);
  const prds: { slug: string; mtime: number; task?: string }[] = [];

  for (const slug of dirs) {
    try {
      const prdPath = join(MEMORY_WORK, slug, "PRD.md");
      const raw = await readFile(prdPath, "utf-8");
      const { data } = matter(raw);
      const stats = await stat(prdPath);
      // Only include sessions with actual content (not empty stubs)
      if (data.phase && data.phase !== "native" && data.task) {
        prds.push({ slug, mtime: stats.mtimeMs, task: data.task as string });
      }
    } catch {
      // skip
    }
  }

  prds.sort((a, b) => b.mtime - a.mtime);
  const selected = prds.slice(0, count);

  console.log(
    `Generating digests for ${selected.length} PRDs (of ${prds.length} total)...\n`
  );

  const results = await batchGenerateDigests(
    selected.map((p) => p.slug),
    (slug, i, total) => {
      const prd = selected.find((p) => p.slug === slug);
      console.log(`[${i}/${total}] ${prd?.task ?? slug}`);
    }
  );

  const succeeded = results.filter((r) => r.path).length;
  const failed = results.filter((r) => r.error).length;

  console.log(`\nDone: ${succeeded} generated, ${failed} failed`);

  if (failed > 0) {
    console.log("\nFailures:");
    for (const r of results.filter((r) => r.error)) {
      console.log(`  ${r.slug}: ${r.error}`);
    }
  }
}

main().catch(console.error);
