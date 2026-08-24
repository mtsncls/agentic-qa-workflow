import { z } from "zod";
import { askClaude } from "./claude";
import { extractJson, stripAnsi } from "../utils/json";
import { config } from "../config/env";
import * as fs from "node:fs";

export const analysisSchema = z.object({
  classification: z.enum(["product_bug", "flaky", "test_issue", "environment"]),
  confidence: z.number().min(0).max(1),
  rootCause: z.string(),
  evidenceSummary: z.string(),
  recommendedAction: z.enum(["create_bug", "retry", "fix_test", "escalate"]),
  severity: z.enum(["highest", "high", "medium", "low"]).default("medium"),
  suggestedFix: z.string().optional(),
});

export type FailureAnalysis = z.infer<typeof analysisSchema>;

export interface TestResult {
  title: string;
  file: string;
  line?: number;
  status: "passed" | "failed" | "skipped" | "flaky";
  durationMs: number;
  errors: string[];
  attachments: { name: string; path: string; type: string }[];
  retries: number;
}

const SYSTEM = `You are an agentic SDET specialized in diagnosing E2E failures with Playwright.
You will receive the details of a failed test (error, stack, spec snippet and evidence paths such as screenshots).
You may use the Read tool to inspect the screenshot image and source files before deciding.
Classify the failure:
- product_bug: the application does not behave as expected.
- flaky: looks like timing/async instability; recommend a retry.
- test_issue: broken selector, outdated or badly written test.
- environment: network/infrastructure/external data issues.
Respond with VALID JSON ONLY:
{"classification":"product_bug|flaky|test_issue|environment","confidence":0.0-1.0,"rootCause":"...","evidenceSummary":"...","recommendedAction":"create_bug|retry|fix_test|escalate","severity":"highest|high|medium|low","suggestedFix":"..."}`;

export interface FailureInput {
  ticketKey: string;
  criterion?: string;
  result: TestResult;
}

function specSnippet(file: string, line?: number): string {
  try {
    const src = fs.readFileSync(file, "utf8").split("\n");
    if (!line) return src.slice(0, 40).join("\n");
    const from = Math.max(0, line - 20);
    return src
      .slice(from, line + 15)
      .map((l, i) => `${from + i + 1}: ${l}`)
      .join("\n");
  } catch {
    return "(could not read file)";
  }
}

/** Deterministic analyst for DRY_RUN based on simple heuristics. */
function dryRunAnalysis(input: FailureInput): FailureAnalysis {
  const err = input.result.errors.join(" ");
  // Failed Playwright assertions include Expected/Received.
  if (/expected[\s\S]*received|received[\s\S]*expected|expect\(.*\)\./i.test(err)) {
    return {
      classification: "product_bug",
      confidence: 0.85,
      rootCause: "[dry-run] Observed behavior differs from what the criterion expects.",
      evidenceSummary: "Screenshot and error message reviewed by the DRY_RUN heuristic.",
      recommendedAction: "create_bug",
      severity: "high",
      suggestedFix: "Review the flow implementation against the acceptance criterion.",
    };
  }
  if (/timeouterror|net::ERR/i.test(err)) {
    return {
      classification: "environment",
      confidence: 0.6,
      rootCause: "Infrastructure timeout or unavailable service detected by heuristic.",
      evidenceSummary: "Error message suggests latency or an unavailable service.",
      recommendedAction: "retry",
      severity: "low",
    };
  }
  return {
    classification: "test_issue",
    confidence: 0.5,
    rootCause: "[dry-run] Could not classify better without an LLM.",
    evidenceSummary: "n/a",
    recommendedAction: "fix_test",
    severity: "medium",
  };
}

export async function analyzeFailure(input: FailureInput): Promise<FailureAnalysis> {
  if (config.DRY_RUN) return dryRunAnalysis(input);

  const { result } = input;
  const prompt = [
    `JIRA TICKET: ${input.ticketKey}`,
    input.criterion ? `RELATED ACCEPTANCE CRITERION:\n${input.criterion}` : "",
    "",
    `FAILED TEST: "${result.title}"`,
    `FILE: ${result.file}${result.line ? `:${result.line}` : ""}`,
    `PREVIOUS RETRIES: ${result.retries}`,
    "",
    "ERROR MESSAGES:",
    result.errors.map((e) => stripAnsi(e).slice(0, 1200)).join("\n---\n") || "(no error)",
    "",
    `SPEC SNIPPET (${result.file}):`,
    "```typescript",
    specSnippet(result.file, result.line),
    "```",
    "",
    result.attachments.length
      ? `AVAILABLE EVIDENCE (you may read it with Read): ${result.attachments.map((a) => a.path).join(", ")}`
      : "NO ATTACHED EVIDENCE.",
    "",
    "Analyze it and respond ONLY with the classification JSON.",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await askClaude(prompt, {
    system: SYSTEM,
    allowedTools: ["Read", "Glob", "Grep"],
    maxTurns: 6,
  });
  return extractJson(raw, analysisSchema);
}
