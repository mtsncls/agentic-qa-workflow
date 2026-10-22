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
  /** Playwright project names the run was executed with (e.g. ["chromium"]). */
  projects?: string[];
  stats: RunStats;
  results?: ManifestTestResult[];
}

/**
 * One test outcome as stored in the manifest. Carries the evidence the agent
 * analysed (duration, error, stack, screenshot paths) so downstream consumers
 * — uReport, the metrics aggregator — never have to re-read the Playwright
 * report. Attachment paths are relative to the run's output dir.
 */
export interface ManifestTestResult {
  title: string;
  file: string;
  line?: number;
  status: TestStatus;
  tags: string[];
  durationMs?: number;
  startTime?: string;
  retries?: number;
  errors?: string[];
  stack?: string;
  location?: { file: string; line: number; column: number };
  attachments?: { name: string; path: string; type: string }[];
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

/**
 * Cross-build analytics read back from uReport
 * (POST /api/analytics/*). Serialised to reporting/ureport-history.json and
 * rendered by the GitHub Pages dashboard, so the published site can show
 * trends that span every build uReport has seen — not just one run.
 */
export interface UReportAnalytics {
  generatedAt: string;
  serverUrl: string;
  /** Deep link to the uReport app (the root URL serves the marketing page). */
  appUrl: string;
  product: string;
  type: string;
  topFailures: { uid: string; name: string; failCount: number; lastFailedAt: string }[];
  slowestTests: { uid: string; name: string; avgDurationMs: number; maxDurationMs: number; runCount: number }[];
  passRateHistory: {
    build: number;
    passRate: number;
    totalTests: number;
    startTime: string;
    isAnomaly: boolean;
  }[];
  buildDurationHistory: {
    build: number;
    startTime: string;
    durationMs: number;
    configCount: number;
  }[];
}
