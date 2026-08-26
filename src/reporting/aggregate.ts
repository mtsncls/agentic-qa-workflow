import * as fs from "node:fs";
import * as path from "node:path";
import type { PipelineManifest, RunMetrics } from "./types";
import { runIdFor, toRunMetrics } from "./metrics";

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR ?? "artifacts";
const HISTORY_PATH = process.env.METRICS_HISTORY_PATH ?? path.join("reporting", "metrics-history.json");

function findManifests(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(dir, e.name, "manifest.json"))
    .filter((p) => fs.existsSync(p));
}

function loadManifest(file: string): PipelineManifest | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as PipelineManifest;
  } catch (err) {
    console.warn(`[reporting] Could not parse ${file}: ${(err as Error).message}`);
    return null;
  }
}

function loadHistory(file: string): RunMetrics[] {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as RunMetrics[]) : [];
  } catch {
    console.warn(`[reporting] ${file} was unreadable JSON; starting a fresh history.`);
    return [];
  }
}

function mergeById(existing: RunMetrics[], incoming: RunMetrics[]): RunMetrics[] {
  const byId = new Map(existing.map((r) => [r.runId, r]));
  for (const r of incoming) byId.set(r.runId, r); // last write wins, e.g. a re-run overwrites
  return [...byId.values()].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );
}

function summarize(history: RunMetrics[]): void {
  const runs = history.length;
  const tests = history.reduce(
    (acc, r) => {
      acc.total += r.tests.total;
      acc.passed += r.tests.passed;
      acc.failed += r.tests.failed;
      acc.flaky += r.tests.flaky;
      return acc;
    },
    { total: 0, passed: 0, failed: 0, flaky: 0 }
  );
  const bugs = history.reduce((a, r) => a + r.bugsCreated, 0);
  const confidences = history.map((r) => r.avgConfidence).filter((c): c is number => c != null);
  const avgConf = confidences.length
    ? (confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(2)
    : "n/a";

  console.log(`\n[reporting] ${runs} run(s) in history`);
  console.log(
    `[reporting] tests: ${tests.passed}/${tests.total} passed` +
      (tests.failed ? ` | ${tests.failed} failed` : "") +
      (tests.flaky ? ` | ${tests.flaky} flaky` : "")
  );
  console.log(`[reporting] bugs auto-created: ${bugs} | avg analyst confidence: ${avgConf}`);
}

function main(): void {
  const manifestFiles = findManifests(ARTIFACTS_DIR);
  if (!manifestFiles.length) {
    console.log(`[reporting] No manifest.json found under ${ARTIFACTS_DIR}/ — nothing to aggregate.`);
  }

  const newMetrics: RunMetrics[] = [];
  for (const file of manifestFiles) {
    const manifest = loadManifest(file);
    if (!manifest) continue;
    const runId = runIdFor(manifest, path.basename(path.dirname(file)));
    newMetrics.push(toRunMetrics(manifest, runId));
  }

  const existing = loadHistory(HISTORY_PATH);
  const merged = mergeById(existing, newMetrics);

  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(merged, null, 2) + "\n");

  console.log(`[reporting] Wrote ${merged.length} run(s) to ${HISTORY_PATH} (${newMetrics.length} new this pass).`);
  summarize(merged);
}

main();
