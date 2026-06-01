#!/usr/bin/env bun
/**
 * Heartbeat Cron — Run as a standalone daemon or crontab entry.
 *
 * Usage:
 *   bun scripts/heartbeat-cron.ts              # Scan once
 *   bun scripts/heartbeat-cron.ts --daemon     # Run every 30 minutes
 *   bun scripts/heartbeat-cron.ts --interval 5 # Run every 5 minutes (daemon)
 */

import { scanActiveSessions } from "../server/coherence/heartbeat";

async function scan() {
  const state = await scanActiveSessions();
  const now = new Date().toLocaleTimeString();
  console.log(
    `[${now}] Heartbeat: ${state.activeSessions.length} active sessions across ${Object.keys(state.projectSummary).length} projects`
  );
  for (const [name, info] of Object.entries(state.projectSummary)) {
    console.log(`  ${name}: ${info.sessionCount} session(s)`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--daemon")) {
    const intervalIdx = args.indexOf("--interval");
    const minutes =
      intervalIdx !== -1 ? parseInt(args[intervalIdx + 1], 10) : 30;

    console.log(`Heartbeat daemon started (every ${minutes} minutes)`);
    await scan();

    setInterval(scan, minutes * 60 * 1000);
  } else {
    await scan();
  }
}

main().catch(console.error);
