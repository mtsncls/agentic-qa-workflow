import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "../config/env";
import { getJira } from "../jira";
import { extractCriteria, type AcceptanceCriterion } from "../jira/acceptance";
import { postRunComment } from "../jira/reporter";
import { listSpecs, runPlaywright, type RunReport } from "../playwright/runner";
import { planTesting, type TestPlan } from "../agents/planner";
import { generateMissingTests } from "../agents/generator";
import { handleFailures, type Decision } from "../decisions/engine";
import { assertClaudeConfigured, assertJiraConfigured } from "../config/env";
import { log } from "../utils/logger";

export interface PipelineOptions {
  ticket: string;
  generate?: boolean;
}

export interface PipelineSummary {
  ticket: string;
  issueUrl: string;
  criteria: AcceptanceCriterion[];
  plan: TestPlan | null;
  generated: string[];
  run: Pick<RunReport, "startedAt" | "finishedAt" | "outputDir" | "stats">;
  decisions: Decision[];
  bugsCreated: string[];
  manifestPath: string;
}

/**
 * Pipeline completo del workflow de QA Agéntico:
 *
 *   Jira (AC) → Planner (Claude) → [generación de tests] → Playwright
 *     → Analyst (Claude) → Engine de decisiones → Jira (bugs / comentarios / transiciones)
 */
export async function runPipeline(opts: PipelineOptions): Promise<PipelineSummary> {
  assertJiraConfigured();
  const jira = getJira();
  const startedAll = Date.now();

  // ── 1. Ticket + criterios de aceptación ─────────────────────────────────
  log.banner(`QA AGENTIC PIPELINE · ${opts.ticket}`);
  log.step("jira", `Obteniendo ticket ${opts.ticket}…`);
  const issue = await jira.getIssue(opts.ticket);
  log.ok("jira", `"${issue.fields.summary}" (${issue.fields.status?.name ?? "?"}) — ${jira.issueUrl(issue.key)}`);

  const criteria = extractCriteria(issue);
  log.info("jira", `${criteria.length} criterios de aceptación detectados`);
  criteria.forEach((c) => log.info("ac", `${c.index}. ${c.text.slice(0, 110)}`));

  // ── 2. Planner agéntico: AC ↔ tests existentes ──────────────────────────
  assertClaudeConfigured();
  log.step("planner", "Mapeando criterios contra el inventario de specs…");
  const inventory = listSpecs();
  const plan = await planTesting(opts.ticket, issue.fields.summary, criteria, inventory);
  log.agent("planner", plan.strategy);
  plan.coverage.forEach((c) =>
    log.info(
      "coverage",
      `${c.status === "covered" ? "✔" : "✖"} ${c.criterion.slice(0, 80)}${c.matchedTest ? ` → ${c.matchedTest}` : ""}`
    )
  );

  // ── 3. Generación agéntica de tests faltantes (opcional) ────────────────
  let generatedFiles: string[] = [];
  if (opts.generate && plan.generate.length) {
    log.step("generator", `${plan.generate.length} spec(s) a generar con Claude Code…`);
    generatedFiles = (await generateMissingTests(plan)).map((g) => g.file);
    plan.specsToRun.push(...generatedFiles);
  } else if (plan.generate.length) {
    log.warn("generator", `${plan.generate.length} criterio(s) sin cobertura (usa --generate para crear tests automáticamente)`);
  }

  if (!plan.specsToRun.length) {
    throw new Error("El planner no seleccionó ningún spec para ejecutar.");
  }

  // ── 4. Ejecución Playwright ──────────────────────────────────────────────
  log.step("playwright", `Ejecutando ${plan.specsToRun.length} spec(s) contra ${config.APP_BASE_URL}`);
  const run = await runPlaywright([...new Set(plan.specsToRun)], { label: `pipeline-${opts.ticket.replace(/[^\w-]/g, "")}` });
  log.ok(
    "playwright",
    `${run.stats.passed}/${run.stats.total} OK` +
      (run.stats.failed ? ` | ❌ ${run.stats.failed}` : "") +
      (run.stats.flaky ? ` | ⚠️ flaky ${run.stats.flaky}` : "")
  );
  log.info("artifacts", run.outputDir);

  // ── 5. Análisis + decisiones automáticas sobre fallas ────────────────────
  const failures = run.results.filter((r) => r.status === "failed");
  const criterionFor = (testTitle: string): string | undefined =>
    plan.coverage.find((c) =>
      c.matchedTest?.toLowerCase().includes(testTitle.toLowerCase()) ||
      testTitle.toLowerCase().includes(c.criterion.split(",")[0].slice(0, 25).toLowerCase())
    )?.criterion;

  const { decisions, bugsCreated } = failures.length
    ? await handleFailures(failures, { ticketKey: opts.ticket, criterionFor })
    : { decisions: [] as Decision[], bugsCreated: [] as string[] };

  // ── 6. Cierre en Jira: comentario con el resultado y transición opcional ─
  await postRunComment(opts.ticket, {
    total: run.stats.total,
    passed: run.stats.passed,
    failed: run.stats.failed,
    flaky: run.stats.flaky,
    bugsCreated,
    runUrl: jira.issueUrl(opts.ticket),
    notes: [
      `Evidencia local: ${path.resolve(run.outputDir)}`,
      ...(decisions.length ? decisions.map((d) => `${d.test}: ${d.rationale}`) : []),
      `Estrategia: ${plan.strategy}`,
    ],
  });

  if (!failures.length && !run.stats.flaky && config.JIRA_TRANSITION_PASS) {
    const moved = await jira.transitionByName(opts.ticket, config.JIRA_TRANSITION_PASS);
    if (moved) {
      log.ok("jira", `${opts.ticket} movido con transición "${config.JIRA_TRANSITION_PASS}"`);
    } else {
      log.warn("jira", `Transición "${config.JIRA_TRANSITION_PASS}" no encontrada`);
    }
  }

  // ── 7. Manifest de la corrida (auditoría completa) ───────────────────────
  const summary: PipelineSummary = {
    ticket: opts.ticket,
    issueUrl: jira.issueUrl(opts.ticket),
    criteria,
    plan,
    generated: generatedFiles,
    run: { startedAt: run.startedAt, finishedAt: run.finishedAt, outputDir: run.outputDir, stats: run.stats },
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

  log.banner("RESUMEN DEL PIPELINE");
  console.log(`Ticket:        ${summary.issueUrl}`);
  console.log(`Tests:         ${run.stats.passed}/${run.stats.total} OK (${run.stats.failed} fallas, ${run.stats.flaky} flaky)`);
  console.log(`Bugs creados:  ${bugsCreated.join(", ") || "ninguno"}`);
  console.log(`Generados:     ${generatedFiles.join(", ") || "ninguno"}`);
  console.log(`Manifest:      ${summary.manifestPath}`);
  console.log(`Duración:      ${((Date.now() - startedAll) / 1000).toFixed(1)}s`);

  return summary;
}
