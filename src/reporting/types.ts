/**
 * Mirrors the shapes written by src/workflow/pipeline.ts (PipelineSummary),
 * src/agents/planner.ts (TestPlan), src/playwright/runner.ts (RunReport.stats)
 * and src/decisions/engine.ts (Decision) — i.e. exactly what ends up in
 * artifacts/<run-id>/manifest.json. Kept as a separate, dependency-free file
 * so the reporting module never has to import the whole agent stack.
 */

export type TestStatus = "passed" | "failed" | "skipped" | "flaky";

export interface RunStats {
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  total: number;
}

export interface RunInfo {
  startedAt: string;
  finishedAt: string;
  outputDir: string;
  stats: RunStats;
  results?: { title: string; file: string; status: TestStatus; tags: string[] }[];
}

export interface CoverageEntry {
  criterion: string;
  status: "covered" | "missing";
  matchedTest?: string;
  tags?: string[];
}

export interface TestPlan {
  ticket: string;
  strategy: string;
  coverage: CoverageEntry[];
  specsToRun: string[];
  generate: { file: string; title: string; criterion: string; rationale: string }[];
  notes: string;
}

export type Classification = "product_bug" | "flaky" | "test_issue" | "environment";
export type RecommendedAction = "create_bug" | "retry" | "fix_test" | "escalate";
export type Severity = "highest" | "high" | "medium" | "low";

export interface FailureAnalysis {
  classification: Classification;
  confidence: number;
  rootCause: string;
  evidenceSummary: string;
  recommendedAction: RecommendedAction;
  severity: Severity;
  suggestedFix?: string;
}

export type DecisionAction = "none" | "retry" | "create_bug" | "comment" | "escalate";

export interface Decision {
  test: string;
  file: string;
  initialStatus: TestStatus;
  finalStatus: "passed" | "failed" | "flaky";
  analysis?: FailureAnalysis;
  action: DecisionAction;
  bugKey?: string;
  rationale: string;
}

/** Full contents of artifacts/<run-id>/manifest.json */
export interface PipelineManifest {
  ticket: string;
  issueUrl: string;
  plan: TestPlan;
  generated: string[];
  run: RunInfo;
  decisions: Decision[];
  bugsCreated: string[];
  manifestPath: string;
}

/**
 * Lightweight, long-lived summary distilled from one PipelineManifest.
 * This is what gets appended to reporting/metrics-history.json.
 * Deliberately excludes anything bulky (screenshots/traces stay local
 * to artifacts/, which is gitignored) or ticket-content-sensitive
 * (error messages, root causes) — the history file is meant to be
 * safe to commit and safe to publish on GitHub Pages.
 */
export interface RunMetrics {
  runId: string;
  ticket: string;
  issueUrl: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  tests: RunStats;
  coverage: { total: number; covered: number; missing: number };
  generatedSpecs: number;
  decisions: {
    total: number;
    byAction: Record<DecisionAction, number>;
  };
  classifications: Record<Classification, number>;
  avgConfidence: number | null;
  bugsCreated: number;
  /** Per business-risk-tag rollup (coverage, test outcomes, bugs, confidence). */
  risk: Record<string, RiskMetric>;
}

export interface RiskMetric {
  criteria: number;
  covered: number;
  missing: number;
  passed: number;
  failed: number;
  flaky: number;
  bugs: number;
  avgConfidence: number | null;
}
