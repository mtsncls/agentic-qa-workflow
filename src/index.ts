#!/usr/bin/env node
import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { runPipeline } from "./workflow/pipeline";
import { getJira } from "./jira";
import { assertJiraConfigured, config } from "./config/env";
import { extractCriteria } from "./jira/acceptance";
import { planTesting } from "./agents/planner";
import { listSpecs } from "./playwright/runner";
import { log } from "./utils/logger";

const program = new Command();

program
  .name("agentic-qa")
  .description("Workflow de QA Agéntico: Jira → Claude Code → Playwright → análisis → acciones en Jira");

program
  .command("run")
  .description("Ejecuta el pipeline completo sobre un ticket de Jira")
  .requiredOption("-t, --ticket <key>", "Key del ticket (ej: QA-101)")
  .option("-g, --generate", "Generar automáticamente specs para criterios sin cobertura", false)
  .action(async (opts: { ticket: string; generate: boolean }) => {
    try {
      await runPipeline({ ticket: opts.ticket.toUpperCase(), generate: opts.generate });
    } catch (err) {
      log.error("pipeline", (err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("plan")
  .description("Solo genera y muestra el plan de testing (no ejecuta tests ni toca Jira)")
  .requiredOption("-t, --ticket <key>", "Key del ticket")
  .action(async (opts: { ticket: string }) => {
    try {
      assertJiraConfigured();
      const jira = getJira();
      const issue = await jira.getIssue(opts.ticket.toUpperCase());
      const criteria = extractCriteria(issue);
      log.ok("jira", `${issue.key}: ${issue.fields.summary} — ${criteria.length} criterios`);
      const plan = await planTesting(issue.key, issue.fields.summary, criteria, listSpecs());
      console.log(JSON.stringify(plan, null, 2));
    } catch (err) {
      log.error("plan", (err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("test")
  .description("Solo ejecuta la suite Playwright local (sin agentes ni Jira)")
  .action(() => {
    const res = spawnSync("npx", ["playwright", "test"], { stdio: "inherit" });
    process.exitCode = res.status ?? 1;
  });

program
  .command("jira-check")
  .description("Verifica credenciales y conectividad con Jira")
  .action(async () => {
    try {
      assertJiraConfigured();
      const jira = getJira();
      const me = await jira.myself();
      log.ok("jira", `Autenticado como ${me.displayName}${me.emailAddress ? ` (${me.emailAddress})` : ""}`);
      log.info("jira", `Base URL: ${config.JIRA_BASE_URL || "(mock)"} · Proyecto por defecto: ${config.JIRA_PROJECT_KEY}`);
    } catch (err) {
      log.error("jira", (err as Error).message);
      process.exitCode = 1;
    }
  });

program.parseAsync();
