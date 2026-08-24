import type { FailureAnalysis, TestResult } from "../agents/analyst";
import { getJira } from "./index";
import { config } from "../config/env";
import { log } from "../utils/logger";
import * as fs from "node:fs";

export interface EvidenceFile {
  name: string;
  path: string;
}

export function collectEvidence(result: TestResult): EvidenceFile[] {
  return result.attachments
    .filter((a) => a.path && fs.existsSync(a.path))
    .map((a) => ({ name: `${a.name || a.type}.${extFor(a.path)}`, path: a.path }));
}

function extFor(p: string): string {
  const m = p.match(/\.(png|webm|zip|jpg|jpeg|txt|json)$/i);
  return m ? m[1] : "bin";
}

/** Comentario de resumen de la corrida sobre el ticket de Jira. */
export async function postRunComment(
  ticketKey: string,
  summary: {
    total: number;
    passed: number;
    failed: number;
    flaky: number;
    bugsCreated: string[];
    runUrl?: string;
    notes?: string[];
  }
): Promise<void> {
  const jira = getJira();
  const lines: string[] = [
    "🤝 *Reporte automático de QA Agéntico*",
    "",
    `Resultados Playwright: *${summary.passed}/${summary.total} OK*` +
      (summary.failed ? ` | ❌ ${summary.failed} fallas` : "") +
      (summary.flaky ? ` | ⚠️ ${summary.flaky} flaky` : ""),
  ];
  if (summary.bugsCreated.length) {
    lines.push(`Bugs creados automáticamente: ${summary.bugsCreated.map((b) => b).join(", ")}`);
  }
  if (summary.notes?.length) lines.push("", ...summary.notes.map((n) => `- ${n}`));
  if (summary.runUrl) lines.push("", `Evidencia completa: ${summary.runUrl}`);

  await jira.addComment(ticketKey, lines.join("\n"));
  log.ok("jira", `Comentario de resultados publicado en ${ticketKey}`);
}

/**
 * Crea un bug en Jira con toda la evidencia y lo linkea al ticket origen.
 * Devuelve la key del bug.
 */
export async function createBugWithEvidence(
  sourceTicket: string,
  criterion: string,
  failure: TestResult,
  analysis: FailureAnalysis,
  evidence: EvidenceFile[]
): Promise<string> {
  const jira = getJira();

  const description = [
    "*Origen:* Pipeline QA Agéntico (Claude + Playwright)",
    `*Ticket padre:* ${sourceTicket} (${jira.issueUrl(sourceTicket)})`,
    `*Criterio de aceptación relacionado:* ${criterion || "(no mapeado)"}`,
    `*Test:* \`${failure.title}\` — \`${failure.file}:${failure.line ?? "?"}\``,
    "",
    "*Error observado:*",
    `{code}${failure.errors[0]?.slice(0, 1500) ?? "(sin mensaje)"}{code}`,
    "",
    "*Análisis del agente (Claude):*",
    `- Clasificación: ${analysis.classification} (confianza ${analysis.confidence})`,
    `- Causa raíz probable: ${analysis.rootCause}`,
    `- Evidencia: ${analysis.evidenceSummary}`,
    analysis.suggestedFix ? `- Sugerencia de corrección: ${analysis.suggestedFix}` : "",
    "",
    `_Evidencia adjunta: ${evidence.map((e) => e.name).join(", ") || "ninguna"}_`,
  ]
    .filter(Boolean)
    .join("\n");

  const priority =
    analysis.severity === "highest"
      ? "Highest"
      : analysis.severity === "high"
        ? "High"
        : analysis.severity === "low"
          ? "Low"
          : "Medium";

  const bugKey = await jira.createBug({
    summary: `[QA-Agentic] ${failure.title} (${sourceTicket})`.slice(0, 250),
    descriptionText: description,
    labels: ["agentic-qa", "automated", analysis.classification],
    priority,
  });

  await jira.attachFiles(
    bugKey,
    evidence.map((e) => ({ filename: e.name, path: e.path }))
  );
  await jira.linkIssues(config.JIRA_LINK_TYPE, bugKey, sourceTicket);
  log.ok("jira", `Bug ${bugKey} creado y linkeado a ${sourceTicket}`);
  return bugKey;
}
