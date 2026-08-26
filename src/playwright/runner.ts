import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { TestResult } from "../agents/analyst";
import { config } from "../config/env";
import { log } from "../utils/logger";

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  outputDir: string;
  stats: { passed: number; failed: number; flaky: number; skipped: number; total: number };
  results: TestResult[];
}

export function listSpecs(dir = "tests/e2e"): { file: string; title: string }[] {
  const out: { file: string; title: string }[] = [];
  if (!fs.existsSync(dir)) return out;

  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".spec.ts")) {
        const src = fs.readFileSync(full, "utf8");
        for (const m of src.matchAll(/\btest(?:\.\w+)?\(\s*(['"`])(.+?)\1/g)) {
          out.push({ file: full.replace(/\\/g, "/"), title: m[2] });
        }
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * Extract business-risk tags declared on a spec file via Playwright's `tag`
 * metadata, e.g. `test('...', { tag: ['@auth', '@critical'] }, ...)` or
 * `test.describe('...', { tag: ['@checkout'] }, ...)`. Tags are read only from
 * `tag: [...]` metadata (not from stray `@word` tokens like an `@playwright`
 * import), so the taxonomy stays meaningful. Returns normalized (lowercased,
 * no leading '@') tags.
 */
export function collectSpecTags(file: string): string[] {
  const tags = new Set<string>();
  try {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/tag\s*:\s*\[([^\]]*)\]/g)) {
      for (const t of m[1].matchAll(/['"`]([^'"`]+)['"`]/g)) {
        const n = t[1].replace(/^@/, "").trim().toLowerCase();
        if (n) tags.add(n);
      }
    }
  } catch {
    // file unreadable: treat as no tags
  }
  return [...tags];
}

interface PwAttachment {
  name?: string;
  contentType?: string;
  path?: string;
}
interface PwError {
  message?: string;
}
interface PwResult {
  status?: string;
  duration?: number;
  errors?: PwError[];
  attachments?: PwAttachment[];
}
interface PwSpec {
  title?: string;
  file?: string;
  line?: number;
  ok?: boolean;
  tags?: string[];
  tests?: {
    results?: PwResult[];
    projectName?: string;
  }[];
}
interface PwSuite {
  title?: string;
  suites?: PwSuite[];
  specs?: PwSpec[];
}

function collectSpecs(suite: PwSuite | undefined, acc: PwSpec[] = []): PwSpec[] {
  if (!suite) return acc;
  suite.specs?.forEach((s) => acc.push(s));
  suite.suites?.forEach((s) => collectSpecs(s, acc));
  return acc;
}

function normalizeStatus(s?: string): TestResult["status"] {
  if (s === "passed") return "passed";
  if (s === "skipped") return "skipped";
  return "failed";
}

/** Ejecuta Playwright (CLI) con reporter JSON y parsea los resultados. */
export async function runPlaywright(
  specFiles: string[],
  opts: { grep?: string; label?: string } = {}
): Promise<RunReport> {
  const startedAt = new Date().toISOString();
  const runId = `${opts.label ?? "run"}-${Date.now()}`;
  const outputDir = path.join(config.ARTIFACTS_DIR, runId);
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "pw-report.json");

  const args = [
    "playwright",
    "test",
    ...specFiles,
    "--reporter=json",
    `--output=${outputDir}`,
    ...(opts.grep ? ["--grep", opts.grep] : []),
  ];

  log.step("playwright", `npx ${args.join(" ")}`);

  let stdout = "";
  let stderr = "";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", args, {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    // Playwright exits non-zero when tests fail: that is NOT a runner error.
    child.on("close", () => {
      fs.writeFileSync(reportPath, stdout || "{}");
      resolve();
    });
  });

  const finishedAt = new Date().toISOString();

  let report: { suites?: PwSuite[] };
  try {
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch {
    throw new Error(`No se pudo parsear el reporte JSON de Playwright (${reportPath}). stderr:\n${stderr.slice(0, 800)}`);
  }

  const results: TestResult[] = [];
  for (const rootSuite of report.suites ?? []) {
    for (const spec of collectSpecs(rootSuite)) {
    const test = spec.tests?.find((t) => t.results?.length);
    if (!test?.results?.length) continue;

    const attempts = test.results;
    const lastAttempt = attempts[attempts.length - 1];
    const finalRaw = lastAttempt.status;
    const hadFailureBeforePass =
      normalizeStatus(finalRaw) === "passed" && attempts.some((r) => r.status !== "passed");

    const errors = (lastAttempt.errors ?? [])
      .map((e) => e.message ?? "")
      .filter(Boolean);

    const attachments = (lastAttempt.attachments ?? [])
      .filter((a): a is Required<Pick<PwAttachment, "path">> & PwAttachment => Boolean(a.path))
      .map((a) => ({
        name: a.name ?? path.basename(a.path!),
        path: path.isAbsolute(a.path!) ? a.path! : path.join(outputDir, a.path!),
        type: a.contentType ?? "application/octet-stream",
      }));

    results.push({
      title: spec.title ?? "(untitled)",
      file: spec.file ?? "",
      line: spec.line,
      status: hadFailureBeforePass ? "flaky" : normalizeStatus(finalRaw),
      durationMs: Math.round(lastAttempt.duration ?? 0),
      errors,
      attachments,
      retries: Math.max(0, attempts.length - 1),
      tags: spec.tags ?? [],
    });
    }
  }

  const stats = {
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    flaky: results.filter((r) => r.status === "flaky").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    total: results.length,
  };

  return { startedAt, finishedAt, outputDir, stats, results };
}
