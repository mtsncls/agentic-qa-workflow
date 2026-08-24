import type { FailureAnalysis, TestResult } from "../agents/analyst";
import { getJira } from "../jira";
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

/** Run summary comment posted on the Jira ticket. */
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
    "🤝 *Automatic Agentic QA report*",
    "",
    `Playwright results: *${summary.passed}/${summary.total} OK*` +
      (summary.failed ? ` | ❌ ${summary.failed} failures` : "") +
      (summary.flaky ? ` | ⚠️ ${summary.flaky} flaky` : ""),
  ];
  if (summary.bugsCreated.length) {
    lines.push(`Bugs automatically created: ${summary.bugsCreated.map((b) => b).join(", ")}`);
  }
  if (summary.notes?.length) lines.push("", ...summary.notes.map((n) => `- ${n}`));
  if (summary.runUrl) lines.push("", `Full evidence: ${summary.runUrl}`);

  await jira.addComment(ticketKey, lines.join("\n"));
  log.ok("jira", `Results comment published on ${ticketKey}`);
}

/**
 * Creates a bug in Jira with all the evidence and links it to the source
 * ticket. Returns the bug key.
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
    "*Source:* Agentic QA pipeline (Claude + Playwright)",
    `*Parent ticket:* ${sourceTicket} (${jira.issueUrl(sourceTicket)})`,
    `*Related acceptance criterion:* ${criterion || "(not mapped)"}`,
    `*Test:* \`${failure.title}\` — \`${failure.file}:${failure.line ?? "?"}\``,
    "",
    "*Observed error:*",
    `{code}${failure.errors[0]?.slice(0, 1500) ?? "(no message)"}{code}`,
    "",
    "*Agent analysis (Claude):*",
    `- Classification: ${analysis.classification} (confidence ${analysis.confidence})`,
    `- Probable root cause: ${analysis.rootCause}`,
    `- Evidence: ${analysis.evidenceSummary}`,
    analysis.suggestedFix ? `- Suggested fix: ${analysis.suggestedFix}` : "",
    "",
    `_Attached evidence: ${evidence.map((e) => e.name).join(", ") || "none"}_`,
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
  log.ok("jira", `Bug ${bugKey} created and linked to ${sourceTicket}`);
  return bugKey;
}
