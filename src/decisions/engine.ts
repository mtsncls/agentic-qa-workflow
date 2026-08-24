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
 * Motor de decisiones: combina reglas deterministas con el veredicto del
 * agente analista para decidir y ejecutar acciones (reintento, bug en Jira,
 * comentario o escalado).
 */
export async function handleFailures(
  failures: TestResult[],
  ctx: EngineContext
): Promise<{ decisions: Decision[]; bugsCreated: string[] }> {
  const jira = getJira();
  const decisions: Decision[] = [];
  const bugsCreated: string[] = [];

  for (const failure of failures) {
    log.step("engine", `Analizando falla: "${failure.title}"`);

    const analysis = await analyzeFailure({
      ticketKey: ctx.ticketKey,
      criterion: ctx.criterionFor(failure.title),
      result: failure,
    });

    log.agent(
      "analyst",
      `${analysis.classification} (confianza ${analysis.confidence}) → ${analysis.recommendedAction}`
    );
    if (analysis.rootCause) log.info("analyst", `Causa raíz: ${analysis.rootCause}`);

    // ── Regla 1: reintentos automáticos para fallos posiblemente transitorios ──
    const wantsRetry =
      analysis.recommendedAction === "retry" &&
      analysis.classification !== "product_bug" &&
      failure.retries < config.MAX_RETRIES;

    if (wantsRetry) {
      log.step("engine", `Reintento ${failure.retries + 1}/${config.MAX_RETRIES} de "${failure.title}"`);
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
          rationale: `Pasó al reintento (${analysis.rootCause}). Marcado como flaky; se comenta en Jira sin abrir bug.`,
        });
        await jira.addComment(
          ctx.ticketKey,
          [
            `⚠️ *Posible flaky*: el test \`${failure.title}\` falló pero pasó en reintento automático.`,
            `Análisis del agente: ${analysis.rootCause}`,
          ].join("\n")
        );
        continue;
      }

      log.warn("engine", "El reintento también falló; se procede con la evaluación definitiva.");
    }

    // ── Regla 2: bug automático si el agente confirma product_bug con confianza suficiente ──
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
        if (!moved) log.warn("jira", `Transición "${config.JIRA_TRANSITION_BUG}" no disponible para ${ctx.ticketKey}`);
      }
    } else if (!shouldCreateBug && analysis.classification === "product_bug") {
      log.warn(
        "engine",
        `product_bug con confianza ${analysis.confidence} < umbral ${config.BUG_CONFIDENCE_THRESHOLD}; no se abre bug automáticamente.`
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
        ? `Bug ${bugKey} creado con evidencia adjunta.`
        : `Sin apertura automática de bug (${analysis.classification}, confianza ${analysis.confidence}).`,
    });
  }

  return { decisions, bugsCreated };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
