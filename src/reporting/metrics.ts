import type {
  Classification,
  Decision,
  DecisionAction,
  PipelineManifest,
  RiskMetric,
  RunMetrics,
} from "./types";
import { mergeTags } from "../risk";

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
    risk: buildRiskMetrics(manifest),
  };
}

function emptyRisk(): RiskMetric & { confSum: number; confCount: number } {
  return {
    criteria: 0,
    covered: 0,
    missing: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    bugs: 0,
    avgConfidence: null,
    confSum: 0,
    confCount: 0,
  };
}

/**
 * Rolls coverage, test outcomes, bugs and analyst confidence up by business-risk
 * tag. A coverage entry or a test result contributes to every tag it carries,
 * so a single test tagged both `@auth` and `@critical` counts for both.
 */
function buildRiskMetrics(manifest: PipelineManifest): Record<string, RiskMetric> {
  const byTag = new Map<string, RiskMetric & { confSum: number; confCount: number }>();
  const get = (tag: string) => {
    let m = byTag.get(tag);
    if (!m) {
      m = emptyRisk();
      byTag.set(tag, m);
    }
    return m;
  };

  for (const c of manifest.plan.coverage) {
    for (const tag of c.tags ?? []) {
      const m = get(tag);
      m.criteria += 1;
      if (c.status === "covered") m.covered += 1;
      else if (c.status === "missing") m.missing += 1;
    }
  }

  for (const r of manifest.run.results ?? []) {
    for (const tag of r.tags) {
      const m = get(tag);
      if (r.status === "passed") m.passed += 1;
      else if (r.status === "failed") m.failed += 1;
      else if (r.status === "flaky") m.flaky += 1;
    }
  }

  const fileTags = new Map<string, string[]>();
  for (const c of manifest.plan.coverage) {
    if (c.matchedTest) fileTags.set(c.matchedTest, mergeTags(fileTags.get(c.matchedTest), c.tags));
  }

  for (const d of manifest.decisions) {
    for (const tag of fileTags.get(d.file) ?? []) {
      const m = get(tag);
      if (d.action === "create_bug") m.bugs += 1;
      if (d.analysis?.confidence != null) {
        m.confSum += d.analysis.confidence;
        m.confCount += 1;
      }
    }
  }

  const out: Record<string, RiskMetric> = {};
  for (const [tag, m] of byTag) {
    out[tag] = {
      criteria: m.criteria,
      covered: m.covered,
      missing: m.missing,
      passed: m.passed,
      failed: m.failed,
      flaky: m.flaky,
      bugs: m.bugs,
      avgConfidence: m.confCount ? Math.round((m.confSum / m.confCount) * 1000) / 1000 : null,
    };
  }
  return out;
}
