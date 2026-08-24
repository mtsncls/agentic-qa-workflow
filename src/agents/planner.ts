import { z } from "zod";
import type { AcceptanceCriterion } from "../jira/acceptance";
import { askClaude } from "./claude";
import { extractJson } from "../utils/json";
import { config, } from "../config/env";

export interface SpecInventoryItem {
  file: string;
  title: string;
}

const coverageSchema = z.object({
  criterion: z.string(),
  status: z.enum(["covered", "missing"]),
  matchedTest: z.string().optional(),
});

export const testPlanSchema = z.object({
  ticket: z.string(),
  strategy: z.string(),
  coverage: z.array(coverageSchema),
  specsToRun: z.array(z.string()),
  generate: z
    .array(
      z.object({
        file: z.string(),
        title: z.string(),
        criterion: z.string(),
        rationale: z.string(),
      })
    )
    .default([]),
  notes: z.string().default(""),
});

export type TestPlan = z.infer<typeof testPlanSchema>;

const SYSTEM = `Eres un QA Lead agéntico dentro de un pipeline de testing automatizado.
Tu trabajo: dado un ticket de Jira con criterios de aceptación y el inventario de tests Playwright existentes,
decidir qué ejecutar para validar el ticket.
Reglas:
- Mapea cada criterio a un test existente cuando sea posible (compara intención semántica, no texto literal).
- Los criterios sin cobertura van con status "missing" y generan una entrada en "generate".
- "specsToRun" debe contener SOLO rutas relativas de archivos .spec.ts relevantes (tests/e2e/...).
- Responde ÚNICAMENTE con JSON válido (sin markdown ni explicaciones), con este formato exacto:
{"ticket":"...","strategy":"...","coverage":[{"criterion":"...","status":"covered|missing","matchedTest":"título del test"}],"specsToRun":["tests/e2e/x.spec.ts"],"generate":[{"file":"tests/e2e/y.spec.ts","title":"...","criterion":"...","rationale":"..."}],"notes":"..."}`;

function buildPrompt(
  issueSummary: string,
  criteria: AcceptanceCriterion[],
  inventory: SpecInventoryItem[]
): string {
  const inv = inventory.map((s) => `- ${s.file} :: "${s.title}"`).join("\n") || "(vacío)";
  const ac = criteria.map((c) => `${c.index}. ${c.text}`).join("\n");
  return [
    `TICKET: ${issueSummary}`,
    "",
    "CRITERIOS DE ACEPTACIÓN:",
    ac,
    "",
    "INVENTARIO DE TESTS PLAYWRIGHT EXISTENTES:",
    inv,
    "",
    "Genera el plan de testing en JSON.",
  ].join("\n");
}

/** Planner determinista para DRY_RUN: cubre todo con los specs existentes. */
function dryRunPlan(ticket: string, criteria: AcceptanceCriterion[], inventory: SpecInventoryItem[]): TestPlan {
  const files = [...new Set(inventory.map((i) => i.file))];
  return {
    ticket,
    strategy: "[dry-run] Ejecutar suite E2E existente contra todos los criterios.",
    coverage: criteria.map((c) => ({
      criterion: c.text,
      status: "covered" as const,
      matchedTest: files[0],
    })),
    specsToRun: files,
    generate: [],
    notes: "Plan generado en modo DRY_RUN (sin LLM).",
  };
}

export async function planTesting(
  ticketKey: string,
  issueSummary: string,
  criteria: AcceptanceCriterion[],
  inventory: SpecInventoryItem[]
): Promise<TestPlan> {
  if (config.DRY_RUN) return dryRunPlan(ticketKey, criteria, inventory);

  const raw = await askClaude(buildPrompt(issueSummary, criteria, inventory), {
    system: SYSTEM,
    maxTurns: 2,
  });
  const plan = extractJson(raw, testPlanSchema);
  return { ...plan, ticket: ticketKey };
}
