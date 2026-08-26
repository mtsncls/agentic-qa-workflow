import { z } from "zod";
import type { AcceptanceCriterion } from "../jira/acceptance";
import { askClaude } from "./claude";
import { extractJson } from "../utils/json";
import { config, } from "../config/env";
import { collectSpecTags } from "../playwright/runner";
import { mergeTags } from "../risk";

export interface SpecInventoryItem {
  file: string;
  title: string;
}

const coverageSchema = z.object({
  criterion: z.string(),
  status: z.enum(["covered", "missing"]),
  matchedTest: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export const testPlanSchema = z.object({
  ticket: z.string(),
  strategy: z.string(),
  coverage: z.array(coverageSchema),
  specsToRun: z.array(z.string()),
  generate: z
    .array(
      z.object({
        file: z.string(),
        title: z.string(),
        criterion: z.string(),
        rationale: z.string(),
      })
    )
    .default([]),
  notes: z.string().default(""),
});

export type TestPlan = z.infer<typeof testPlanSchema>;

const SYSTEM = `You are an agentic QA Lead inside an automated testing pipeline.
Your job: given a Jira ticket with acceptance criteria and the inventory of existing Playwright tests,
decide what to run to validate the ticket.
Rules:
- Map each criterion to an existing test when possible (compare semantic intent, not literal text).
- Criteria without coverage go with status "missing" and produce an entry in "generate".
- "specsToRun" must contain ONLY relative paths of relevant .spec.ts files (tests/e2e/...).
- Respond with VALID JSON ONLY (no markdown, no explanations), using this exact shape:
{"ticket":"...","strategy":"...","coverage":[{"criterion":"...","status":"covered|missing","matchedTest":"test title"}],"specsToRun":["tests/e2e/x.spec.ts"],"generate":[{"file":"tests/e2e/y.spec.ts","title":"...","criterion":"...","rationale":"..."}],"notes":"..."}`;

function buildPrompt(
  issueSummary: string,
  criteria: AcceptanceCriterion[],
  inventory: SpecInventoryItem[]
): string {
  const inv = inventory.map((s) => `- ${s.file} :: "${s.title}"`).join("\n") || "(empty)";
  const ac = criteria.map((c) => `${c.index}. ${c.text}`).join("\n");
  return [
    `TICKET: ${issueSummary}`,
    "",
    "ACCEPTANCE CRITERIA:",
    ac,
    "",
    "EXISTING PLAYWRIGHT TEST INVENTORY:",
    inv,
    "",
    "Generate the testing plan as JSON.",
  ].join("\n");
}

/**
 * Merge Jira criterion tags with the matched spec file's Playwright tags so a
 * single coverage entry carries the full business-risk picture.
 */
function enrichCoverageWithTags(
  coverage: TestPlan["coverage"],
  criteria: AcceptanceCriterion[],
  inventory: SpecInventoryItem[]
): TestPlan["coverage"] {
  const critByText = new Map(criteria.map((c) => [c.text, c]));
  const fileByTitle = new Map(inventory.map((i) => [i.title, i.file]));
  const cache = new Map<string, string[]>();
  const fileTags = (file?: string): string[] => {
    if (!file) return [];
    if (!cache.has(file)) cache.set(file, collectSpecTags(file));
    return cache.get(file)!;
  };
  return coverage.map((c) => {
    const crit =
      critByText.get(c.criterion) ??
      criteria.find((x) => c.criterion.includes(x.text) || x.text.includes(c.criterion));
    const file = c.matchedTest?.endsWith(".spec.ts")
      ? c.matchedTest
      : fileByTitle.get(c.matchedTest ?? "");
    return { ...c, tags: mergeTags(c.tags, crit?.tags, fileTags(file)) };
  });
}

/** Deterministic planner for DRY_RUN: covers everything with existing specs. */
function dryRunPlan(ticket: string, criteria: AcceptanceCriterion[], inventory: SpecInventoryItem[]): TestPlan {
  const files = [...new Set(inventory.map((i) => i.file))];
  const coverage = enrichCoverageWithTags(
    criteria.map((c) => ({
      criterion: c.text,
      status: "covered" as const,
      matchedTest: files[0],
      tags: [] as string[],
    })),
    criteria,
    inventory
  );
  return {
    ticket,
    strategy: "[dry-run] Run the existing E2E suite against all criteria.",
    coverage,
    specsToRun: files,
    generate: [],
    notes: "Plan generated in DRY_RUN mode (no LLM).",
  };
}

export async function planTesting(
  ticketKey: string,
  issueSummary: string,
  criteria: AcceptanceCriterion[],
  inventory: SpecInventoryItem[]
): Promise<TestPlan> {
  if (config.DRY_RUN) return dryRunPlan(ticketKey, criteria, inventory);

  const raw = await askClaude(buildPrompt(issueSummary, criteria, inventory), {
    system: SYSTEM,
    maxTurns: 2,
  });
  const plan = extractJson(raw, testPlanSchema);
  return {
    ...plan,
    ticket: ticketKey,
    coverage: enrichCoverageWithTags(plan.coverage, criteria, inventory),
  };
}
