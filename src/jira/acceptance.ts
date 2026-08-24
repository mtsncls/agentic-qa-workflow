import { adfToText } from "./adf";
import type { JiraIssue } from "./types";
import { config } from "../config/env";

export interface AcceptanceCriterion {
  index: number;
  text: string;
}

/** Extrae el texto crudo del campo configurado como criterios de aceptación. */
function rawAcText(issue: JiraIssue): string {
  const field = config.JIRA_AC_FIELD;
  if (field === "description") return adfToText(issue.fields.description);
  const value = issue.fields[field];
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return adfToText(value as never);
  return "";
}

/**
 * Divide el texto en criterios individuales.
 * Prioriza líneas con viñetas (-, *, •) o numeradas; si no hay, usa párrafos
 * que empiecen con palabras tipo Gherkin ("Dado", "Given", "Cuando"...);
 * como último recurso, cada línea no vacía es un criterio.
 */
export function extractCriteria(issue: JiraIssue): AcceptanceCriterion[] {
  const lines = rawAcText(issue).split(/\r?\n/);

  let candidates = lines.filter((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l));
  if (candidates.length === 0) {
    candidates = lines.filter((l) =>
      /^(dado|given|cuando|when|entonces|then|como|as a)/i.test(l.trim())
    );
  }
  if (candidates.length === 0) {
    candidates = lines.map((l) => l.trim()).filter(Boolean);
  }

  return candidates
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .map((text, i) => ({ index: i + 1, text }));
}
