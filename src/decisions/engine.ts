import { analyzeFailure, type FailureAnalysis, type TestResult } from "../agents/analyst";
import { createBugWithEvidence, collectEvidence, type EvidenceFile } from "../jira/reporter";
import { getJira } from "../jira";
import { runPlaywright } from "../playwright/runner";
import { config } from "../config/env";
import { log } from "../utils/logger";

export type DecisionAction = "none" | "retry" | "create_bug" | "comment" | "escalate";

export interface Decision {
  test: string;
  file: string;
  initialStatus: TestResult["status"];
  finalStatus: "passed" | "failed" | "flaky";
  analysis?: FailureAnalysis;
  action: DecisionAction;
  bugKey?: string;
  rationale: string;
}

export interface EngineContext {
  ticketKey: string;
  criterionFor: (testTitle: string) => string | undefined;
}

/**
 * Decision engine: combines deterministic rules with the analyst agent's
 * verdict to decide and execute actions (retry, Jira bug, comment or escalate).
 */
export async function handleFailures(
  failures: TestResult[],
  ctx: EngineContext
): Promise<{ decisions: Decision[]; bugsCreated: string[] }> {
  const jira = getJira();
  const decisions: Decision[] = [];
  const bugsCreated: string[] = [];

  for (const failure of failures) {
    log.step("engine", `Analyzing failure: "${failure.title}"`);

    const analysis = await analyzeFailure({
      ticketKey: ctx.ticketKey,
      criterion: ctx.criterionFor(failure.title),
      result: failure,
    });

    log.agent(
      "analyst",
      `${analysis.classification} (confidence ${analysis.confidence}) → ${analysis.recommendedAction}`
    );
    if (analysis.rootCause) log.info("analyst", `Root cause: ${analysis.rootCause}`);

    // ── Rule 1: automatic retries for possibly transient failures ──────────
    const wantsRetry =
      analysis.recommendedAction === "retry" &&
      analysis.classification !== "product_bug" &&
      failure.retries < config.MAX_RETRIES;

    if (wantsRetry) {
      log.step("engine", `Retry ${failure.retries + 1}/${config.MAX_RETRIES} of "${failure.title}"`);
      const rerun = await runPlaywright([failure.file], {
        grep: escapeRegExp(failure.title),
        label: "retry",
      });
      const retried = rerun.results.find((r) => r.title === failure.title);

      if (retried?.status === "passed") {
        decisions.push({
          test: failure.title,
          file: failure.file,
          initialStatus: failure.status,
          finalStatus: "flaky",
          analysis,
          action: "comment",
          rationale: `Passed on retry (${analysis.rootCause}). Marked as flaky; commented on Jira without opening a bug.`,
        });
        await jira.addComment(
          ctx.ticketKey,
          [
            `⚠️ *Possible flaky*: the test \`${failure.title}\` failed but passed on automatic retry.`,
            `Agent analysis: ${analysis.rootCause}`,
          ].join("\n")
        );
        continue;
      }

      log.warn("engine", "The retry also failed; proceeding with the definitive evaluation.");
    }

    // ── Rule 2: automatic bug when the agent confirms product_bug with enough confidence
    const shouldCreateBug =
      analysis.classification === "product_bug" &&
      analysis.confidence >= config.BUG_CONFIDENCE_THRESHOLD;

    let evidence: EvidenceFile[] = [];
    let bugKey: string | undefined;

    if (shouldCreateBug) {
      evidence = collectEvidence(failure);
      bugKey = await createBugWithEvidence(
        ctx.ticketKey,
        ctx.criterionFor(failure.title) ?? "",
        failure,
        analysis,
        evidence
      );
      bugsCreated.push(bugKey);

      if (config.JIRA_TRANSITION_BUG) {
        const moved = await jira.transitionByName(ctx.ticketKey, config.JIRA_TRANSITION_BUG);
        if (!moved) log.warn("jira", `Transition "${config.JIRA_TRANSITION_BUG}" not available for ${ctx.ticketKey}`);
      }
    } else if (!shouldCreateBug && analysis.classification === "product_bug") {
      log.warn(
        "engine",
        `product_bug with confidence ${analysis.confidence} < threshold ${config.BUG_CONFIDENCE_THRESHOLD}; not opening a bug automatically.`
      );
    }

    decisions.push({
      test: failure.title,
      file: failure.file,
      initialStatus: failure.status,
      finalStatus: "failed",
      analysis,
      action: bugKey ? "create_bug" : analysis.recommendedAction === "escalate" ? "escalate" : "comment",
      bugKey,
      rationale: bugKey
        ? `Bug ${bugKey} created with attached evidence.`
        : `No automatic bug opening (${analysis.classification}, confidence ${analysis.confidence}).`,
    });
  }

  return { decisions, bugsCreated };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
