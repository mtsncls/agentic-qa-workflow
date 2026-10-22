/**
 * Reads uReport's cross-build analytics and writes them to
 * reporting/ureport-history.json, which the GitHub Pages dashboard renders.
 *
 * Unlike the manifest-derived metrics history (one entry per pipeline run),
 * this file holds trends computed by uReport across every build it knows —
 * top failures, slowest tests, pass-rate history and build durations.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fetchAnalytics } from "./ureport";
import { ureportConfigured } from "../config/env";

const HISTORY_PATH =
  process.env.UREPORT_HISTORY_PATH ?? path.join("reporting", "ureport-history.json");

async function main(): Promise<void> {
  if (!ureportConfigured()) {
    console.log(
      "[ureport] UREPORT_URL and UREPORT_API_TOKEN are not set — skipping the analytics refresh."
    );
    return;
  }

  const analytics = await fetchAnalytics();
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(analytics, null, 2) + "\n");

  console.log(`[ureport] Wrote analytics for ${analytics.product}/${analytics.type} to ${HISTORY_PATH}`);
  console.log(
    `[ureport] top failures: ${analytics.topFailures.length} | slowest: ${analytics.slowestTests.length} | ` +
      `pass-rate points: ${analytics.passRateHistory.length} | build durations: ${analytics.buildDurationHistory.length}`
  );
}

main().catch((err) => {
  console.error(`[ureport] ${(err as Error).message}`);
  process.exit(1);
});
