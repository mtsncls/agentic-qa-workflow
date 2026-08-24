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
  .description("Agentic QA workflow: Jira → Claude Code → Playwright → analysis → Jira actions");

program
  .command("run")
  .description("Runs the full pipeline against a Jira ticket")
  .requiredOption("-t, --ticket <key>", "Ticket key (e.g. QA-101)")
  .option("-g, --generate", "Automatically generate specs for uncovered criteria", false)
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
  .description("Only generates and prints the testing plan (no tests run, no Jira writes)")
  .requiredOption("-t, --ticket <key>", "Ticket key")
  .action(async (opts: { ticket: string }) => {
    try {
      assertJiraConfigured();
      const jira = getJira();
      const issue = await jira.getIssue(opts.ticket.toUpperCase());
      const criteria = extractCriteria(issue);
      log.ok("jira", `${issue.key}: ${issue.fields.summary} — ${criteria.length} criteria`);
      const plan = await planTesting(issue.key, issue.fields.summary, criteria, listSpecs());
      console.log(JSON.stringify(plan, null, 2));
    } catch (err) {
      log.error("plan", (err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("test")
  .description("Only runs the local Playwright suite (no agents, no Jira)")
  .action(() => {
    const res = spawnSync("npx", ["playwright", "test"], { stdio: "inherit" });
    process.exitCode = res.status ?? 1;
  });

program
  .command("jira-check")
  .description("Verifies Jira credentials and connectivity")
  .action(async () => {
    try {
      assertJiraConfigured();
      const jira = getJira();
      const me = await jira.myself();
      log.ok("jira", `Authenticated as ${me.displayName}${me.emailAddress ? ` (${me.emailAddress})` : ""}`);
      log.info("jira", `Base URL: ${config.JIRA_BASE_URL || "(mock)"} · Default project: ${config.JIRA_PROJECT_KEY}`);
    } catch (err) {
      log.error("jira", (err as Error).message);
      process.exitCode = 1;
    }
  });

program.parseAsync();
