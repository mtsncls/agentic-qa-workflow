/**
 * Business-risk taxonomy shared by the planner, the pipeline manifest and the
 * reporting aggregator. Risk tags let us track QA health by *business exposure*
 * (auth, payment, revenue, ...) instead of a single generic coverage number.
 *
 * Tags come from two sources, merged per coverage entry:
 *  - Jira acceptance criteria text: `[auth]`, `risk: auth, pii`, `@auth`, `#auth`
 *  - Playwright test metadata: `test('...', { tag: ['@auth', '@critical'] }, ...)`
 */

export const RISK_TAGS = [
  "auth",
  "pii",
  "checkout",
  "cart",
  "payment",
  "revenue",
  "navigation",
  "regression",
  "critical",
  "performance",
] as const;

export type RiskTag = (typeof RISK_TAGS)[number];

export function isKnownRiskTag(value: string): value is RiskTag {
  return (RISK_TAGS as readonly string[]).includes(value);
}

/** Lowercase, strip a leading '@' or '#'. */
export function normalizeTag(raw: string): string {
  return raw.replace(/^[@#]/, "").trim().toLowerCase();
}

/**
 * Parse risk tags from free text (a criterion body, a label list, etc.).
 * Recognises bracketed tokens `[auth]`, a `risk:`/`tags:` keyword, and
 * `@tag` / `#tag` markers. Deliberately does NOT do bare-word matching to
 * avoid false positives (the word "cart" can appear in unrelated copy).
 */
export function parseRiskTags(text: string): string[] {
  const found = new Set<string>();

  for (const m of text.matchAll(/\[([^\]]+)\]/g)) {
    for (const part of m[1].split(/[\s,/]+/)) {
      const n = normalizeTag(part);
      if (n) found.add(n);
    }
  }

  const kw = text.match(/(?:\brisk|\btags)\s*:\s*([^\n]+)/i);
  if (kw) {
    for (const part of kw[1].split(/[\s,;]+/)) {
      const n = normalizeTag(part);
      if (n) found.add(n);
    }
  }

  for (const m of text.matchAll(/[@#]([a-z0-9_-]+)/gi)) {
    const n = normalizeTag(m[1]);
    if (n) found.add(n);
  }

  return [...found];
}

/** Remove risk-tag markers from a string so the criterion text stays clean. */
export function stripTagMarkers(text: string): string {
  return text
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/(?:\brisk|\btags)\s*:\s*[^\n]+/i, " ")
    .replace(/[@#][a-z0-9_-]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Union helper that keeps only recognised + normalised tags. */
export function mergeTags(...lists: (string[] | undefined)[]): string[] {
  const out = new Set<string>();
  for (const list of lists) {
    for (const t of list ?? []) {
      const n = normalizeTag(t);
      if (n) out.add(n);
    }
  }
  return [...out];
}
