import { adfToText } from "./adf";
import type { JiraIssue } from "./types";
import { config } from "../config/env";

export interface AcceptanceCriterion {
  index: number;
  text: string;
}

/** Extracts the raw text of the field configured as acceptance criteria. */
function rawAcText(issue: JiraIssue): string {
  const field = config.JIRA_AC_FIELD;
  if (field === "description") return adfToText(issue.fields.description);
  const value = issue.fields[field];
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return adfToText(value as never);
  return "";
}

/**
 * Splits the text into individual criteria.
 * Prefers bullet lines (-, *, •) or numbered items; falls back to paragraphs
 * starting with Gherkin-like words ("Given", "When", "Then", or their Spanish
 * equivalents "Dado", "Cuando", "Entonces"); last resort: every non-empty line.
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
