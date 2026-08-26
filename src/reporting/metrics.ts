import type {
  Classification,
  Decision,
  DecisionAction,
  PipelineManifest,
  RunMetrics,
} from "./types";

const EMPTY_ACTION_COUNTS: Record<DecisionAction, number> = {
  none: 0,
  retry: 0,
  create_bug: 0,
  comment: 0,
  escalate: 0,
};

const EMPTY_CLASSIFICATION_COUNTS: Record<Classification, number> = {
  product_bug: 0,
  flaky: 0,
  test_issue: 0,
  environment: 0,
};

function countActions(decisions: Decision[]): Record<DecisionAction, number> {
  const out = { ...EMPTY_ACTION_COUNTS };
  for (const d of decisions) out[d.action] = (out[d.action] ?? 0) + 1;
  return out;
}

function countClassifications(decisions: Decision[]): Record<Classification, number> {
  const out = { ...EMPTY_CLASSIFICATION_COUNTS };
  for (const d of decisions) {
    if (d.analysis) out[d.analysis.classification] = (out[d.analysis.classification] ?? 0) + 1;
  }
  return out;
}

function avgConfidence(decisions: Decision[]): number | null {
  const scores = decisions.map((d) => d.analysis?.confidence).filter((c): c is number => c != null);
  if (!scores.length) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000;
}

/** Derives a stable, sortable run id from the manifest's own output dir. */
export function runIdFor(manifest: PipelineManifest, fallback: string): string {
  const base = manifest.run?.outputDir?.split(/[\\/]/).filter(Boolean).pop();
  return base || fallback;
}

export function toRunMetrics(manifest: PipelineManifest, runId: string): RunMetrics {
  const covered = manifest.plan.coverage.filter((c) => c.status === "covered").length;
  const missing = manifest.plan.coverage.filter((c) => c.status === "missing").length;
  const started = new Date(manifest.run.startedAt).getTime();
  const finished = new Date(manifest.run.finishedAt).getTime();

  return {
    runId,
    ticket: manifest.ticket,
    issueUrl: manifest.issueUrl,
    startedAt: manifest.run.startedAt,
    finishedAt: manifest.run.finishedAt,
    durationMs: Number.isFinite(finished - started) ? finished - started : 0,
    tests: manifest.run.stats,
    coverage: { total: manifest.plan.coverage.length, covered, missing },
    generatedSpecs: manifest.generated.length,
    decisions: {
      total: manifest.decisions.length,
      byAction: countActions(manifest.decisions),
    },
    classifications: countClassifications(manifest.decisions),
    avgConfidence: avgConfidence(manifest.decisions),
    bugsCreated: manifest.bugsCreated.length,
  };
}
