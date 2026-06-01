/**
 * Obsidian vault registration (#31, continued)
 *
 * Each session-notes folder (<cwd>/skein) is a real Obsidian vault. To make it
 * appear in Obsidian's vault switcher we add an entry to Obsidian's global
 * registry at ~/Library/Application Support/obsidian/obsidian.json.
 *
 * The vault id is a deterministic 16-hex hash of the path, so re-registering
 * the same vault is idempotent. We merge-preserve every existing entry and
 * only add ours. macOS-only (matches Skein's supported platform).
 *
 * Non-fatal by contract: a failure here must never block a note save.
 */

import { readFile, writeFile, mkdir, stat } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

const OBSIDIAN_CONFIG = join(
  homedir(),
  "Library",
  "Application Support",
  "obsidian",
  "obsidian.json"
);

/** Deterministic 16-hex vault id for a path (matches Obsidian's id shape). */
export function vaultIdFor(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}

interface ObsidianConfig {
  vaults: Record<string, { path: string; ts: number; open?: boolean }>;
  [k: string]: unknown;
}

/**
 * Register a vault in Obsidian's global config if not already present.
 * Returns the vault id and whether a new entry was added.
 */
export async function registerObsidianVault(
  vaultPath: string
): Promise<{ id: string; added: boolean }> {
  const id = vaultIdFor(vaultPath);

  let cfg: ObsidianConfig = { vaults: {} };
  let hadConfig = false;
  try {
    cfg = JSON.parse(await readFile(OBSIDIAN_CONFIG, "utf-8")) as ObsidianConfig;
    if (!cfg.vaults) cfg.vaults = {};
    hadConfig = true;
  } catch {
    // No global config yet (Obsidian may never have run). Create the dir.
    try {
      await stat(dirname(OBSIDIAN_CONFIG));
    } catch {
      await mkdir(dirname(OBSIDIAN_CONFIG), { recursive: true });
    }
  }

  // Already registered by path? (preserve whatever id it has)
  const exists = Object.values(cfg.vaults).some((v) => v?.path === vaultPath);
  if (exists) return { id, added: false };

  cfg.vaults[id] = { path: vaultPath, ts: Date.now() };
  // Preserve the rest of the file; only the vaults map changed.
  await writeFile(OBSIDIAN_CONFIG, JSON.stringify(cfg, null, 2), "utf-8");
  void hadConfig;
  return { id, added: true };
}
