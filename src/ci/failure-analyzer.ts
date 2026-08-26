import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { askModel } from "../agents/model";
import { extractJson } from "../utils/json";
import { z } from "zod";

/**
 * CI failure analyzer.
 *
 * Triggered by a failed CI run. It feeds the failed logs to the LLM, which
 * decides whether the failure is auto-fixable in the repository. If so, the
 * proposed file changes are applied and a PR is opened. Otherwise a GitHub
 * issue is opened as a human notification.
 *
 * Safety: only files inside the repository root may be written, dotfiles and
 * `.env` are refused, and all git/PR/issue actions run through `gh`/`git`
 * with the workflow token (no direct pushes to main).
 */

const runId = process.env.RUN_ID ?? "unknown";
const repo = process.env.REPO ?? "";
const ghToken = process.env.GH_TOKEN ?? "";
const logFile = process.env.LOG_FILE ?? "failed.log";
const FIX_CONFIDENCE_THRESHOLD = 0.7;

const verdictSchema = z.object({
  fixable: z.boolean(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  files: z
    .array(z.object({ path: z.string(), content: z.string() }))
    .nullable(),
});

type Verdict = z.infer<typeof verdictSchema>;

const SYSTEM = `You are a senior CI reliability engineer. You receive the failed logs of a
GitHub Actions workflow for a TypeScript + Playwright repository. Diagnose the
root cause. Decide whether the failure is auto-fixable by editing repository
files (NOT secrets, NOT a human decision, NOT a transient infra flake that will
pass on rerun). If fixable, return the COMPLETE new contents of every file that
must change. Respond ONLY with a single JSON object, no markdown:

{"fixable": boolean, "summary": string, "confidence": number 0..1, "rationale": string,
 "files": [{"path": "relative/repo/path", "content": "<full new file contents>"}] | null}

Keep changes minimal and self-contained. If not fixable, set "files" to null.`;

function sh(cmd: string, allowFail = false): string {
  try {
    return execSync(cmd, { stdio: "pipe", encoding: "utf8" });
  } catch (err) {
    if (!allowFail) throw err;
    return "";
  }
}

function runUrl(): string {
  return `https://github.com/${repo}/actions/runs/${runId}`;
}

function safeRepoPath(p: string): string | null {
  const resolved = path.resolve(process.cwd(), p);
  const root = path.resolve(process.cwd());
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  if (p.startsWith(".") || p.includes("..") || p.toLowerCase().includes(".env")) return null;
  return resolved;
}

function notify(message: string): void {
  const body = `## CI failure notification\n\n**Run:** ${runId}\n**Repo:** ${repo}\n\n${message}\n\n[View run](${runUrl()})`;
  fs.writeFileSync("/tmp/notify_body.md", body);
  sh(`gh issue create --title "CI failure: run ${runId}" --body-file /tmp/notify_body.md`, true);
  console.log(`[analyzer] notification issued for run ${runId}`);
}

function applyFix(v: Verdict): void {
  const branch = `fix/ci-${runId}`;
  for (const f of v.files ?? []) {
    const target = safeRepoPath(f.path);
    if (!target) throw new Error(`Refused unsafe path: ${f.path}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.content);
  }

  sh(`git config user.email "ci-failure-analyzer[bot]@users.noreply.github.com"`);
  sh(`git config user.name "ci-failure-analyzer[bot]"`);
  sh(`git remote set-url origin https://x-access-token:${ghToken}@github.com/${repo}.git`);
  sh(`git checkout -b ${branch} || git checkout ${branch}`);
  for (const f of v.files ?? []) sh(`git add "${f.path}"`);
  sh(`git commit -m "fix(ci): auto-fix from failure analysis\n\n${v.summary}"`);
  sh(`git push --set-upstream origin ${branch}`);

  const body = `## Automated CI failure analysis\n\n**Run:** ${runId}\n**Confidence:** ${v.confidence}\n\n${v.summary}\n\n${v.rationale}\n\n[View run](${runUrl()})`;
  fs.writeFileSync("/tmp/pr_body.md", body);
  const prOut = sh(
    `gh pr create --title "fix(ci): ${v.summary.slice(0, 60)}" --body-file /tmp/pr_body.md --base main`
  );
  const prUrl = (prOut.match(/https?:\/\/\S+/) ?? [prOut.trim()])[0];
  console.log(`[analyzer] opened PR from run ${runId}: ${prUrl}`);
}

async function main(): Promise<void> {
  let log = "";
  try {
    log = fs.readFileSync(logFile, "utf8");
  } catch {
    /* no log captured */
  }
  if (log.length > 24000) log = log.slice(log.length - 24000);

  if (!log.trim()) {
    notify("CI run failed but no failure logs could be captured for analysis.");
    return;
  }

  let text: string;
  try {
    text = await askModel(`CI RUN: ${runId}\nREPO: ${repo}\n\nFAILED LOGS:\n${log}`, {
      system: SYSTEM,
      maxTurns: 2,
    });
  } catch (err) {
    notify(`Unable to run AI analysis: ${(err as Error).message}`);
    return;
  }

  let verdict: Verdict;
  try {
    verdict = extractJson(text, verdictSchema);
  } catch {
    notify("Analysis produced no valid JSON; a human should inspect the run.");
    return;
  }

  if (verdict.fixable && verdict.confidence >= FIX_CONFIDENCE_THRESHOLD && verdict.files?.length) {
    try {
      applyFix(verdict);
    } catch (err) {
      notify(`Fix looked possible but failed to apply: ${(err as Error).message}`);
    }
    return;
  }

  notify(`${verdict.summary}\n\n${verdict.rationale}`);
}

main().catch((err) => {
  console.error("[analyzer] unexpected error:", err);
  process.exit(1);
});
