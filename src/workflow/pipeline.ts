import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "../config/env";
import { getJira } from "../jira";
import { extractCriteria, type AcceptanceCriterion } from "../jira/acceptance";
import { postRunComment } from "../jira/reporter";
import { listSpecs, runPlaywright, type RunReport } from "../playwright/runner";
import type { ManifestTestResult } from "../reporting/types";
import { planTesting, type TestPlan } from "../agents/planner";
import { generateMissingTests } from "../agents/generator";
import { handleFailures, type Decision } from "../decisions/engine";
import { assertModelConfigured, assertJiraConfigured, ureportConfigured } from "../config/env";
import { pushManifest } from "../reporting/ureport";
import { log } from "../utils/logger";

export interface PipelineOptions {
  ticket: string;
  generate?: boolean;
}

export interface PipelineSummary {
  ticket: string;
  issueUrl: string;
  criteria: AcceptanceCriterion[];
  plan: TestPlan;
  generated: string[];
  run: {
    startedAt: string;
    finishedAt: string;
    outputDir: string;
    projects: string[];
    stats: RunReport["stats"];
    results: ManifestTestResult[];
  };
  decisions: Decision[];
  bugsCreated: string[];
  manifestPath: string;
}

/**
 * Attachment paths are stored relative to the run's output dir so the manifest
 * stays portable: it can be copied to another machine (or into a CI artifact)
 * and still point at the screenshots that belong to it.
 */
function relativeToRunDir(filePath: string, outputDir: string): string {
  const rel = path.relative(path.resolve(outputDir), path.resolve(filePath));
  return rel && !rel.startsWith("..") ? rel : path.basename(filePath);
}

/**
 * Full agentic QA workflow pipeline:
 *
 *   Jira (AC) → Planner (Claude) → [test generation] → Playwright
 *     → Analyst (Claude) → decision engine → Jira (bugs / comments / transitions)
 */
export async function runPipeline(opts: PipelineOptions): Promise<PipelineSummary> {
  assertJiraConfigured();
  const jira = getJira();
  const startedAll = Date.now();

  // ── 1. Ticket + acceptance criteria ─────────────────────────────────────
  log.banner(`AGENTIC QA PIPELINE · ${opts.ticket}`);
  log.step("jira", `Fetching ticket ${opts.ticket}…`);
  const issue = await jira.getIssue(opts.ticket);
  log.ok("jira", `"${issue.fields.summary}" (${issue.fields.status?.name ?? "?"}) — ${jira.issueUrl(issue.key)}`);

  const criteria = extractCriteria(issue);
  log.info("jira", `${criteria.length} acceptance criteria detected`);
  criteria.forEach((c) => log.info("ac", `${c.index}. ${c.text.slice(0, 110)}`));

  // ── 2. Agentic planner: AC ↔ existing tests ─────────────────────────────
  assertModelConfigured();
  log.step("planner", "Mapping criteria against the spec inventory…");
  const inventory = listSpecs();
  const plan = await planTesting(opts.ticket, issue.fields.summary, criteria, inventory);
  log.agent("planner", plan.strategy);
  plan.coverage.forEach((c) =>
    log.info(
      "coverage",
      `${c.status === "covered" ? "✔" : "✖"} ${c.criterion.slice(0, 80)}${c.matchedTest ? ` → ${c.matchedTest}` : ""}`
    )
  );

  // ── 3. Agentic generation of missing tests (optional) ───────────────────
  let generatedFiles: string[] = [];
  if (opts.generate && plan.generate.length) {
    log.step("generator", `${plan.generate.length} spec(s) to generate with Claude Code…`);
    generatedFiles = (await generateMissingTests(plan)).map((g) => g.file);
    plan.specsToRun.push(...generatedFiles);
  } else if (plan.generate.length) {
    log.warn("generator", `${plan.generate.length} criterion(s) without coverage (use --generate to create tests automatically)`);
  }

  if (!plan.specsToRun.length) {
    throw new Error("The planner did not select any spec to run.");
  }

  // ── 4. Playwright execution ─────────────────────────────────────────────
  log.step("playwright", `Running ${plan.specsToRun.length} spec(s) against ${config.APP_BASE_URL}`);
  const run = await runPlaywright([...new Set(plan.specsToRun)], { label: `pipeline-${opts.ticket.replace(/[^\w-]/g, "")}` });
  log.ok(
    "playwright",
    `${run.stats.passed}/${run.stats.total} OK` +
      (run.stats.failed ? ` | ❌ ${run.stats.failed}` : "") +
      (run.stats.flaky ? ` | ⚠️ flaky ${run.stats.flaky}` : "")
  );
  log.info("artifacts", run.outputDir);

  // ── 5. Analysis + automatic decisions on failures ───────────────────────
  const failures = run.results.filter((r) => r.status === "failed");
  const criterionFor = (testTitle: string): string | undefined =>
    plan.coverage.find((c) =>
      c.matchedTest?.toLowerCase().includes(testTitle.toLowerCase()) ||
      testTitle.toLowerCase().includes(c.criterion.split(",")[0].slice(0, 25).toLowerCase())
    )?.criterion;

  const { decisions, bugsCreated } = failures.length
    ? await handleFailures(failures, { ticketKey: opts.ticket, criterionFor })
    : { decisions: [] as Decision[], bugsCreated: [] as string[] };

  // ── 6. Jira closing: results comment and optional transition ────────────
  await postRunComment(opts.ticket, {
    total: run.stats.total,
    passed: run.stats.passed,
    failed: run.stats.failed,
    flaky: run.stats.flaky,
    bugsCreated,
    runUrl: jira.issueUrl(opts.ticket),
    notes: [
      `Local evidence: ${path.resolve(run.outputDir)}`,
      ...(decisions.length ? decisions.map((d) => `${d.test}: ${d.rationale}`) : []),
      `Strategy: ${plan.strategy}`,
    ],
  });

  if (!failures.length && !run.stats.flaky && config.JIRA_TRANSITION_PASS) {
    const moved = await jira.transitionByName(opts.ticket, config.JIRA_TRANSITION_PASS);
    if (moved) {
      log.ok("jira", `${opts.ticket} moved with transition "${config.JIRA_TRANSITION_PASS}"`);
    } else {
      log.warn("jira", `Transition "${config.JIRA_TRANSITION_PASS}" not found`);
    }
  }

  // ── 7. Run manifest (full audit trail) ──────────────────────────────────
  const summary: PipelineSummary = {
    ticket: opts.ticket,
    issueUrl: jira.issueUrl(opts.ticket),
    criteria,
    plan,
    generated: generatedFiles,
    run: {
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      outputDir: run.outputDir,
      projects: run.projects,
      stats: run.stats,
      results: run.results.map((r) => ({
        title: r.title,
        file: r.file,
        line: r.line,
        status: r.status,
        tags: r.tags ?? [],
        durationMs: r.durationMs,
        startTime: r.startTime,
        retries: r.retries,
        errors: r.errors,
        stack: r.stack,
        location: r.location,
        attachments: r.attachments.map((a) => ({
          name: a.name,
          path: relativeToRunDir(a.path, run.outputDir),
          type: a.type,
        })),
      })),
    },
    decisions,
    bugsCreated,
    manifestPath: "",
  };

  summary.manifestPath = path.join(run.outputDir, "manifest.json");
  fs.writeFileSync(summary.manifestPath, JSON.stringify({ ...summary, criteria: undefined }, null, 2));
  fs.writeFileSync(
    path.join(run.outputDir, "criteria.json"),
    JSON.stringify(criteria, null, 2)
  );

  // ── 8. uReport push (optional) ─────────────────────────────────────────
  // The run is pushed once the manifest exists, so uReport receives the
  // agentic verdict (classification, confidence, Jira bug key) together with
  // the raw Playwright outcome. A failure here must never fail the pipeline.
  if (ureportConfigured()) {
    try {
      const pushed = await pushManifest(summary, run.outputDir);
      if (pushed.tests) {
        log.ok("ureport", `Build ${pushed.buildId} · ${pushed.tests} test(s) pushed`);
      } else {
        log.warn("ureport", pushed.warnings[0] ?? "nothing to push");
      }
      pushed.warnings.forEach((w) => log.warn("ureport", w));
    } catch (err) {
      log.warn("ureport", `Push failed: ${(err as Error).message}`);
    }
  }

  log.banner("PIPELINE SUMMARY");
  console.log(`Ticket:        ${summary.issueUrl}`);
  console.log(`Tests:         ${run.stats.passed}/${run.stats.total} OK (${run.stats.failed} failures, ${run.stats.flaky} flaky)`);
  console.log(`Bugs created:  ${bugsCreated.join(", ") || "none"}`);
  console.log(`Generated:     ${generatedFiles.join(", ") || "none"}`);
  console.log(`Manifest:      ${summary.manifestPath}`);
  console.log(`Duration:      ${((Date.now() - startedAll) / 1000).toFixed(1)}s`);

  return summary;
}
