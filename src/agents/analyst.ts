import { z } from "zod";
import { askClaude } from "./claude";
import { extractJson, stripAnsi } from "../utils/json";
import { config } from "../config/env";
import * as fs from "node:fs";

export const analysisSchema = z.object({
  classification: z.enum(["product_bug", "flaky", "test_issue", "environment"]),
  confidence: z.number().min(0).max(1),
  rootCause: z.string(),
  evidenceSummary: z.string(),
  recommendedAction: z.enum(["create_bug", "retry", "fix_test", "escalate"]),
  severity: z.enum(["highest", "high", "medium", "low"]).default("medium"),
  suggestedFix: z.string().optional(),
});

export type FailureAnalysis = z.infer<typeof analysisSchema>;

export interface TestResult {
  title: string;
  file: string;
  line?: number;
  status: "passed" | "failed" | "skipped" | "flaky";
  durationMs: number;
  errors: string[];
  attachments: { name: string; path: string; type: string }[];
  retries: number;
}

const SYSTEM = `Eres un SDET agéntico especializado en diagnóstico de fallos E2E con Playwright.
Recibirás el detalle de un test fallido (error, stack, snippet del spec y rutas de evidencia como screenshots).
Puedes usar la herramienta Read para inspeccionar la imagen del screenshot y los archivos fuente antes de decidir.
Clasifica el fallo:
- product_bug: la aplicación no cumple el comportamiento esperado.
- flaky: parece inestabilidad de timing/async; recomienda retry.
- test_issue: selector roto, test desactualizado o mal escrito.
- environment: red/infraestructura/datos externos.
Responde ÚNICAMENTE con JSON válido:
{"classification":"product_bug|flaky|test_issue|environment","confidence":0.0-1.0,"rootCause":"...","evidenceSummary":"...","recommendedAction":"create_bug|retry|fix_test|escalate","severity":"highest|high|medium|low","suggestedFix":"..."}`;

export interface FailureInput {
  ticketKey: string;
  criterion?: string;
  result: TestResult;
}

function specSnippet(file: string, line?: number): string {
  try {
    const src = fs.readFileSync(file, "utf8").split("\n");
    if (!line) return src.slice(0, 40).join("\n");
    const from = Math.max(0, line - 20);
    return src
      .slice(from, line + 15)
      .map((l, i) => `${from + i + 1}: ${l}`)
      .join("\n");
  } catch {
    return "(no se pudo leer el archivo)";
  }
}

/** Analista determinista para DRY_RUN basado en heurísticas simples. */
function dryRunAnalysis(input: FailureInput): FailureAnalysis {
  const err = input.result.errors.join(" ");
  // Las aserciones fallidas de Playwright incluyen Expected/Received.
  if (/expected[\s\S]*received|received[\s\S]*expected|expect\(.*\)\./i.test(err)) {
    return {
      classification: "product_bug",
      confidence: 0.85,
      rootCause: "[dry-run] El comportamiento observado difiere del esperado según el criterio.",
      evidenceSummary: "Screenshot y mensaje de error revisados por heurística DRY_RUN.",
      recommendedAction: "create_bug",
      severity: "high",
      suggestedFix: "Revisar implementación del flujo contra el criterio de aceptación.",
    };
  }
  if (/timeouterror|net::ERR/i.test(err)) {
    return {
      classification: "environment",
      confidence: 0.6,
      rootCause: "Timeout de infraestructura o servicio no disponible detectado por heurística.",
      evidenceSummary: "Mensaje de error sugiere latencia o servicio no disponible.",
      recommendedAction: "retry",
      severity: "low",
    };
  }
  return {
    classification: "test_issue",
    confidence: 0.5,
    rootCause: "[dry-run] No se pudo clasificar mejor sin LLM.",
    evidenceSummary: "n/a",
    recommendedAction: "fix_test",
    severity: "medium",
  };
}

export async function analyzeFailure(input: FailureInput): Promise<FailureAnalysis> {
  if (config.DRY_RUN) return dryRunAnalysis(input);

  const { result } = input;
  const prompt = [
    `TICKET JIRA: ${input.ticketKey}`,
    input.criterion ? `CRITERIO DE ACEPTACIÓN RELACIONADO:\n${input.criterion}` : "",
    "",
    `TEST FALLIDO: "${result.title}"`,
    `ARCHIVO: ${result.file}${result.line ? `:${result.line}` : ""}`,
    `REINTENTOS PREVIOS: ${result.retries}`,
    "",
    "MENSAJES DE ERROR:",
    result.errors.map((e) => stripAnsi(e).slice(0, 1200)).join("\n---\n") || "(sin error)",
    "",
    `SNIPPET DEL SPEC (${result.file}):`,
    "```typescript",
    specSnippet(result.file, result.line),
    "```",
    "",
    result.attachments.length
      ? `EVIDENCIA DISPONIBLE (puedes leerla con Read): ${result.attachments.map((a) => a.path).join(", ")}`
      : "SIN EVIDENCIA ADJUNTA.",
    "",
    "Analiza y responde SOLO con el JSON de clasificación.",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await askClaude(prompt, {
    system: SYSTEM,
    allowedTools: ["Read", "Glob", "Grep"],
    maxTurns: 6,
  });
  return extractJson(raw, analysisSchema);
}
