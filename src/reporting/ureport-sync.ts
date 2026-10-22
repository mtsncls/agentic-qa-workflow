/**
 * Pushes every pipeline manifest found under artifacts/ to uReport.
 *
 * The pipeline already pushes each run as it finishes, so this command exists
 * to backfill: it re-pushes the historical runs (useful when uReport is
 * brought up after the fact, or to repair a partially failed push). Re-pushing
 * is safe — uReport upserts builds and relations by their natural keys.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { PipelineManifest } from "./types";
import { pushManifest } from "./ureport";
import { ureportConfigured } from "../config/env";

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR ?? "artifacts";

function findManifests(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(dir, e.name, "manifest.json"))
    .filter((p) => fs.existsSync(p));
}

async function main(): Promise<void> {
  if (!ureportConfigured()) {
    console.error(
      "[ureport] UREPORT_URL and UREPORT_API_TOKEN must both be set. See docs/ureport.md."
    );
    process.exit(1);
  }

  const manifestFiles = findManifests(ARTIFACTS_DIR);
  if (!manifestFiles.length) {
    console.log(`[ureport] No manifest.json found under ${ARTIFACTS_DIR}/ — nothing to push.`);
    return;
  }

  let pushed = 0;
  let failed = 0;
  for (const file of manifestFiles) {
    const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as PipelineManifest;
    const runId = manifest.run?.outputDir?.split(/[\\/]/).filter(Boolean).pop() ?? file;
    try {
      const result = await pushManifest(manifest, path.dirname(file));
      if (!result.tests) {
        console.log(`[ureport] ${runId} → skipped (${result.warnings[0]})`);
        continue;
      }
      pushed += 1;
      console.log(`[ureport] ${runId} → build ${result.buildId} (${result.tests} tests)`);
      result.warnings.forEach((w) => console.warn(`[ureport]   warning: ${w}`));
    } catch (err) {
      failed += 1;
      console.error(`[ureport] ${runId} failed: ${(err as Error).message}`);
    }
  }

  console.log(`[ureport] ${pushed} run(s) pushed, ${failed} failed.`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(`[ureport] ${(err as Error).message}`);
  process.exit(1);
});
