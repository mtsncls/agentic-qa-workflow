import { askClaude } from "./claude";
import { log } from "../utils/logger";
import type { TestPlan } from "./planner";

export interface GeneratedTest {
  file: string;
  title: string;
}

const SYSTEM = `You are a senior SDET writing E2E tests with Playwright + TypeScript.
Before writing code:
1. Read AGENTS.md (repo conventions).
2. Read 1-2 existing specs under tests/e2e/ to mimic the style.
Then create the requested .spec.ts file complying EXACTLY with the conventions.
Do not modify existing files. Do not run commands.`;

/**
 * Generator agent: Claude Code writes the missing specs directly
 * into the repo using its Write/Edit tools.
 */
export async function generateMissingTests(plan: TestPlan): Promise<GeneratedTest[]> {
  const created: GeneratedTest[] = [];

  for (const item of plan.generate) {
    if (!item.file.endsWith(".spec.ts") || item.file.includes("..")) {
      log.warn("generator", `Suspicious path ignored: ${item.file}`);
      continue;
    }

    const prompt = [
      `Create the test file "${item.file}" with a single test titled exactly:`,
      `"${item.title}"`,
      "",
      "The test must validate this acceptance criterion of ticket",
      `${plan.ticket}:`,
      `"${item.criterion}"`,
      "",
      "Strategy context: " + plan.strategy,
    ].join("\n");

    await askClaude(prompt, {
      system: SYSTEM,
      allowedTools: ["Read", "Write", "Glob", "Grep"],
      permissionMode: "acceptEdits",
      maxTurns: 8,
      cwd: process.cwd(),
    });

    created.push({ file: item.file, title: item.title });
    log.ok("generator", `Spec generated: ${item.file}`);
  }

  return created;
}
