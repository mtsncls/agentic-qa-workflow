/**
 * uReport integration — https://github.com/ureport-web/ureport-standalone
 *
 * uReport is a standalone test-reporting server: it stores builds and test
 * results and exposes cross-build analytics (top failures, slowest tests,
 * pass-rate history). This module maps a pipeline manifest onto its push API:
 *
 *   POST /api/build                       → { _id }   upsert by product/type/build
 *   POST /api/test/multi                  → { saved } max 100 tests per call
 *   POST /api/test_relation               → relation  upsert by uid+product+type
 *   POST /api/build/status/calculate/:id  → { status } aggregates the build
 *
 * The push happens *after* the pipeline, so the agentic dimension is included:
 * the analyst's classification, its confidence, the Jira bug key it created
 * and the acceptance-criteria coverage travel with each test. uReport then
 * answers questions like "which tests fail most often" across every build,
 * instead of one run at a time.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "../config/env";
import type {
  Decision,
  ManifestTestResult,
  PipelineManifest,
  TestStatus,
  UReportAnalytics,
} from "./types";

/** uReport rejects batches larger than 100 tests. */
const TEST_BATCH_SIZE = 100;

/** How many test relations are pushed at the same time. */
const RELATION_CONCURRENCY = 5;

const API_TIMEOUT_MS = 20_000;

/** Hosts allowed to serve uReport over plain HTTP (local development). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);

const BROWSER_NAMES: Record<string, string> = {
  chromium: "CHROME",
  chrome: "CHROME",
  firefox: "FIREFOX",
  webkit: "SAFARI",
  edge: "EDGE",
};

/** Info keys uReport turns into first-class relation columns. */
const RESERVED_INFO_KEYS = new Set(["file", "path", "tags", "components", "teams", "duration", "quickInfo"]);

export type UReportStatus = "PASS" | "FAIL" | "SKIP" | "RERUN_PASS";

export interface UReportBuildPayload {
  product: string;
  type: string;
  build: number;
  team?: string;
  browser?: string;
  stage?: string;
  start_time: string;
  environments?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  extras?: Record<string, string>;
}

export interface UReportStepPayload {
  timestamp: string;
  status: "PASS" | "FAIL";
  detail: string;
  attachment?: { screenshot?: string; content?: string; "content-type"?: string };
}

export interface UReportTestPayload {
  uid: string;
  name: string;
  build: string;
  status: UReportStatus;
  start_time: string;
  end_time: string;
  is_rerun: boolean;
  failure?: { error_message: string; stack_trace?: string; token?: string };
  info?: Record<string, unknown>;
  body?: UReportStepPayload[];
}

export interface UReportPushResult {
  buildId: string;
  tests: number;
  /** Non-fatal problems (relations/status could not be saved, missing evidence…). */
  warnings: string[];
}

/**
 * Resolves the uReport base URL, refusing plain HTTP towards anything but a
 * local host: the API token travels in the Authorization header, so a typo in
 * UREPORT_URL must not send it over the wire in clear text.
 */
export function serverBaseUrl(): string {
  const raw = config.UREPORT_URL.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`UREPORT_URL is not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== "https:" && !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `UREPORT_URL must use https (or point at a local host): ${raw}. The API token is sent in the Authorization header.`
    );
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Time budget for one push. Every request is bounded both by its own timeout
 * and by what is left of the budget, so a slow or hanging uReport can slow
 * the pipeline down but never stall it.
 */
class PushBudget {
  private readonly deadline: number;

  constructor(totalMs: number) {
    this.deadline = Date.now() + totalMs;
  }

  get remainingMs(): number {
    return Math.max(0, this.deadline - Date.now());
  }

  get expired(): boolean {
    return this.remainingMs <= 0;
  }
}

/** Error raised when uReport answers with a non-2xx status. */
class UReportApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function api<T>(
  method: "GET" | "POST",
  endpoint: string,
  body: unknown,
  budget: PushBudget
): Promise<T> {
  const base = serverBaseUrl();
  const timeoutMs = Math.min(API_TIMEOUT_MS, budget.remainingMs);
  if (timeoutMs <= 0) throw new Error("uReport push budget exhausted");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${endpoint}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.UREPORT_API_TOKEN}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new UReportApiError(
        res.status,
        `uReport ${method} ${endpoint} → ${res.status} ${detail.slice(0, 300)}`
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`uReport ${method} ${endpoint} → timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Same as `api`, but answers null instead of throwing when the resource is missing. */
async function apiOptional<T>(
  method: "GET" | "POST",
  endpoint: string,
  body: unknown,
  budget: PushBudget
): Promise<T | null> {
  try {
    return await api<T>(method, endpoint, body, budget);
  } catch (err) {
    if (err instanceof UReportApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Stable identifier for a test across builds — uReport uses it to track how a
 * test behaves over time. Derived from the spec file and the test title.
 */
export function buildUid(file: string, title: string): string {
  const spec = path.basename(file).replace(/\.spec\.ts$/, "");
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${spec}::${slug}`.slice(0, 120);
}

/** Maps a pipeline status onto uReport's status vocabulary. */
export function toUreportStatus(status: TestStatus, retries: number): UReportStatus {
  if (status === "failed") return "FAIL";
  if (status === "skipped") return "SKIP";
  // A flaky test passed on a later attempt: uReport tracks that as a rerun.
  if (status === "flaky" || retries > 0) return "RERUN_PASS";
  return "PASS";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function browserFor(projects: string[] | undefined): string | undefined {
  const first = projects?.[0];
  if (!first) return undefined;
  return BROWSER_NAMES[first.toLowerCase()] ?? first.toUpperCase();
}

/** Run id derived from the manifest's own output dir (same rule as the aggregator). */
export function runIdOf(manifest: PipelineManifest): string {
  const base = manifest.run?.outputDir?.split(/[\\/]/).filter(Boolean).pop();
  return base || "unknown";
}

/**
 * uReport build numbers must be numeric and identify one run of one lane.
 * The manifest's start timestamp is used so re-pushing the same manifest
 * updates the same build instead of creating a duplicate.
 */
export function buildNumberFor(manifest: PipelineManifest): number {
  const parsed = Date.parse(manifest.run.startedAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function decisionFor(manifest: PipelineManifest, result: ManifestTestResult): Decision | undefined {
  return manifest.decisions.find((d) => d.file === result.file && d.test === result.title);
}

/** Escape sequences (ESC[…) that Playwright adds to its console output. */
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * Prepares a text for uReport: drops the ANSI escape codes Playwright adds to
 * its console output (they render as garbage in a web report) and removes the
 * local repository path before the text leaves the machine. Playwright's error
 * messages and stack frames embed absolute paths (which disclose the
 * developer's home directory and the CI runner's layout).
 */
export function redactPaths(text: string): string {
  const plain = text.replace(ANSI_PATTERN, "");
  if (!config.UREPORT_REDACT_PATHS) return plain;
  const root = process.cwd();
  return plain.split(root).join("<repo>");
}

/** Reads a failure screenshot and returns it base64-encoded for uReport. */
function readScreenshot(result: ManifestTestResult, runDir: string): string | undefined {
  if (!config.UREPORT_ATTACH_SCREENSHOTS) return undefined;
  for (const attachment of result.attachments ?? []) {
    if (!attachment.type?.startsWith("image/")) continue;
    try {
      return fs.readFileSync(path.resolve(runDir, attachment.path)).toString("base64");
    } catch {
      // Evidence not on this machine (manifest copied without its artifacts).
    }
  }
  return undefined;
}

function buildSteps(result: ManifestTestResult, runDir: string, timestamp: string): UReportStepPayload[] {
  const screenshot = readScreenshot(result, runDir);
  const errors = (result.errors ?? []).filter(Boolean);
  const steps: UReportStepPayload[] = errors.map((message, i) => ({
    timestamp,
    status: "FAIL",
    detail: redactPaths(message).slice(0, 2000),
    ...(i === 0 && screenshot ? { attachment: { screenshot } } : {}),
  }));
  if (!steps.length && screenshot) {
    steps.push({ timestamp, status: "FAIL", detail: "Failure evidence (screenshot)", attachment: { screenshot } });
  }
  return steps;
}

/** The agentic overlay uReport stores alongside each test result. */
function agenticFields(manifest: PipelineManifest, decision: Decision | undefined): Record<string, unknown> {
  if (!decision) return {};
  return {
    agentClassification: decision.analysis?.classification,
    agentConfidence: decision.analysis?.confidence,
    agentSeverity: decision.analysis?.severity,
    agentAction: decision.action,
    agentRationale: decision.rationale,
    jiraBug: decision.bugKey,
  };
}

export function manifestToBuildPayload(manifest: PipelineManifest): UReportBuildPayload {
  const coverage = manifest.plan?.coverage ?? [];
  const covered = coverage.filter((c) => c.status === "covered").length;
  const riskTags = [
    ...new Set((manifest.run.results ?? []).flatMap((r) => r.tags ?? [])),
  ].sort();

  const verdicts = { product_bug: 0, flaky: 0, test_issue: 0, environment: 0 };
  for (const d of manifest.decisions) {
    const c = d.analysis?.classification;
    if (c && c in verdicts) verdicts[c] += 1;
  }
  const confidences = manifest.decisions
    .map((d) => d.analysis?.confidence)
    .filter((c): c is number => typeof c === "number");
  const avgConfidence = confidences.length
    ? Math.round((confidences.reduce((a, c) => a + c, 0) / confidences.length) * 1000) / 1000
    : "";

  return {
    product: config.UREPORT_PRODUCT,
    type: config.UREPORT_TYPE,
    build: buildNumberFor(manifest),
    team: config.UREPORT_TEAM || undefined,
    browser: browserFor(manifest.run.projects),
    stage: config.UREPORT_STAGE || undefined,
    start_time: manifest.run.startedAt,
    environments: { baseURL: config.APP_BASE_URL },
    settings: { agentRetries: String(config.MAX_RETRIES) },
    extras: {
      ticket: manifest.ticket,
      runId: runIdOf(manifest),
      issueUrl: manifest.issueUrl,
      app: config.APP_BASE_URL,
      coverage: `${covered}/${coverage.length}`,
      criteria: String(coverage.length),
      generatedSpecs: String(manifest.generated.length),
      bugsCreated: String(manifest.bugsCreated.length),
      verdicts: `product_bug=${verdicts.product_bug};flaky=${verdicts.flaky};test_issue=${verdicts.test_issue};environment=${verdicts.environment}`,
      avgConfidence: String(avgConfidence),
      risk: riskTags.join(","),
      projects: (manifest.run.projects ?? []).join(","),
    },
  };
}

export function manifestToTestPayloads(
  manifest: PipelineManifest,
  buildId: string,
  runDir: string
): UReportTestPayload[] {
  return (manifest.run.results ?? []).map((result) => {
    const decision = decisionFor(manifest, result);
    const startTime = result.startTime ?? manifest.run.startedAt;
    const endTime = new Date(Date.parse(startTime) + (result.durationMs ?? 0)).toISOString();
    const tags = result.tags ?? [];

    const payload: UReportTestPayload = {
      uid: buildUid(result.file, result.title),
      name: result.title,
      build: buildId,
      status: toUreportStatus(result.status, result.retries ?? 0),
      start_time: startTime,
      end_time: endTime,
      is_rerun: result.status === "flaky" || (result.retries ?? 0) > 0,
      info: {
        file: path.basename(result.file),
        path: path.dirname(result.file) === "." ? "" : path.dirname(result.file),
        // uReport stores tags with the "@" prefix and filters on it.
        tags: tags.map((t) => `@${t}`),
        // Business-risk tags become components so uReport can slice by risk.
        components: tags,
        duration: formatDuration(result.durationMs ?? 0),
        quickInfo: [
          { key: "jira_ticket", value: manifest.ticket },
          { key: "jira_url", value: manifest.issueUrl },
          { key: "run_id", value: runIdOf(manifest) },
        ],
        ...agenticFields(manifest, decision),
      },
    };

    if (result.status === "failed") {
      const token = result.location
        ? `${path.basename(result.location.file)}:${result.location.line}:${result.location.column}`
        : result.line
          ? `${path.basename(result.file)}:${result.line}`
          : undefined;
      payload.failure = {
        error_message:
          redactPaths((result.errors ?? []).join("\n")) || "The test failed without an error message.",
        stack_trace: result.stack ? redactPaths(result.stack) : undefined,
        token,
      };
      payload.body = buildSteps(result, runDir, endTime);
    }

    return payload;
  });
}

/** Runs `fn` over `items` with a bounded number of concurrent calls. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Pushes one pipeline run to uReport as a build with its test results.
 * `runDir` is the directory holding the manifest (and its evidence).
 */
export async function pushManifest(
  manifest: PipelineManifest,
  runDir: string
): Promise<UReportPushResult> {
  const warnings: string[] = [];
  const budget = new PushBudget(config.UREPORT_DEADLINE_MS);
  const payloads = manifestToTestPayloads(manifest, "", runDir);

  // Nothing to report: an empty build would only add noise to uReport.
  if (!payloads.length) {
    return { buildId: "", tests: 0, warnings: ["the manifest has no test results; nothing to push"] };
  }

  const build = await api<{ _id?: string }>(
    "POST",
    "/api/build",
    manifestToBuildPayload(manifest),
    budget
  );
  const buildId = build._id;
  if (!buildId) throw new Error("uReport did not return a build id");

  for (const payload of payloads) payload.build = buildId;

  // `/api/test/multi` always inserts, it never updates: pushing the same
  // manifest twice would duplicate every test result and pollute the
  // cross-build analytics. The build number is derived from the manifest's
  // start time, so the build already holding results means "already pushed".
  const existing = await apiOptional<{ status?: { total?: number } }>(
    "POST",
    `/api/build/status/calculate/${buildId}`,
    undefined,
    budget
  );
  const alreadyPushed = (existing?.status?.total ?? 0) > 0;

  if (alreadyPushed) {
    warnings.push("the build already had test results; the insert was skipped");
  } else {
    for (let i = 0; i < payloads.length; i += TEST_BATCH_SIZE) {
      const batch = payloads.slice(i, i + TEST_BATCH_SIZE);
      const res = await api<{ saved?: number }>(
        "POST",
        "/api/test/multi",
        { tests: batch, isOrdered: true },
        budget
      );
      if (typeof res.saved === "number" && res.saved !== batch.length) {
        throw new Error(`uReport saved ${res.saved} of ${batch.length} tests`);
      }
    }
  }

  // Test relations are uReport's cross-build test inventory. Losing them only
  // costs the trend views, so a failure here must not fail the whole push.
  // They are pushed concurrently: one request per test, and a serial loop
  // would multiply the timeout by the number of tests.
  await mapWithConcurrency(payloads, RELATION_CONCURRENCY, async (payload) => {
    const info = payload.info ?? {};
    try {
      await api(
        "POST",
        "/api/test_relation",
        {
          uid: payload.uid,
          product: config.UREPORT_PRODUCT,
          type: config.UREPORT_TYPE,
          file: info.file,
          path: info.path,
          tags: ((info.tags as string[]) ?? []).map((name) => ({ name })),
          components: ((info.components as string[]) ?? []).map((name) => ({ name })),
          teams: [],
          customs: Object.fromEntries(
            Object.entries(info).filter(([key]) => !RESERVED_INFO_KEYS.has(key))
          ),
        },
        budget
      );
    } catch (err) {
      warnings.push(`relation ${payload.uid}: ${(err as Error).message}`);
    }
  });

  try {
    await api("POST", `/api/build/status/calculate/${buildId}`, undefined, budget);
  } catch (err) {
    warnings.push(`status/calculate: ${(err as Error).message}`);
  }

  return { buildId, tests: payloads.length, warnings };
}

interface RawTopFailure {
  _id: string;
  name: string;
  failCount: number;
  lastFailedAt: string;
}

interface RawSlowestTest {
  _id: string;
  name: string;
  avgDuration: number;
  maxDuration: number;
  runCount: number;
}

interface RawPassRate {
  build: number;
  passRate: number;
  totalTests: number;
  start_time: string;
  isAnomaly: boolean;
}

interface RawBuildDuration {
  build: number;
  start_time: string;
  durationMs: number;
  configCount: number;
}

/**
 * Reads uReport's cross-build analytics. These are the numbers the GitHub
 * Pages dashboard publishes: unlike the per-run manifest history, they span
 * every build uReport has seen.
 */
export async function fetchAnalytics(): Promise<UReportAnalytics> {
  const product = config.UREPORT_PRODUCT;
  const type = config.UREPORT_TYPE;
  const budget = new PushBudget(config.UREPORT_DEADLINE_MS);

  // `since` means days for the history endpoints but a date for the
  // failure/slowness ones, so the two groups get different bodies.
  const scoped = { product, type, limit: 20 };
  const historical = { product, type, limit: 20, since: 90 };

  const [topFailures, slowestTests, passRateHistory, buildDurationHistory] = await Promise.all([
    api<RawTopFailure[]>("POST", "/api/analytics/top-failures", scoped, budget),
    api<RawSlowestTest[]>("POST", "/api/analytics/slowest-tests", scoped, budget),
    api<RawPassRate[]>("POST", "/api/analytics/pass-rate-history", historical, budget),
    api<RawBuildDuration[]>("POST", "/api/analytics/build-duration-history", historical, budget),
  ]);

  const serverUrl = serverBaseUrl();

  return {
    generatedAt: new Date().toISOString(),
    serverUrl,
    // The root URL serves uReport's marketing page; the app lives under
    // /nextgen, and /nextgen/overview is the landing view after login.
    appUrl: `${serverUrl}/nextgen/overview`,
    product,
    type,
    topFailures: (topFailures ?? []).map((f) => ({
      uid: f._id,
      name: f.name,
      failCount: f.failCount,
      lastFailedAt: f.lastFailedAt,
    })),
    slowestTests: (slowestTests ?? []).map((t) => ({
      uid: t._id,
      name: t.name,
      avgDurationMs: t.avgDuration,
      maxDurationMs: t.maxDuration,
      runCount: t.runCount,
    })),
    passRateHistory: (passRateHistory ?? []).map((p) => ({
      build: p.build,
      passRate: p.passRate,
      totalTests: p.totalTests,
      startTime: p.start_time,
      isAnomaly: Boolean(p.isAnomaly),
    })),
    buildDurationHistory: (buildDurationHistory ?? []).map((d) => ({
      build: d.build,
      startTime: d.start_time,
      durationMs: d.durationMs,
      configCount: d.configCount,
    })),
  };
}
