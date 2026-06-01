import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const INFERENCE_TOOL = join(
  homedir(),
  ".claude",
  "PAI",
  "TOOLS",
  "Inference.ts"
);

let availability: boolean | null = null;
let warned = false;

export function inferenceAvailable(): boolean {
  if (availability === null) {
    availability = existsSync(INFERENCE_TOOL);
  }
  return availability;
}

export function warnInferenceMissingOnce(feature: string): void {
  if (warned) return;
  warned = true;
  console.warn(
    `[skein] Skipping AI feature "${feature}": missing ${INFERENCE_TOOL}`
  );
}
