import { askClaude } from "./claude";
import { log } from "../utils/logger";
import type { TestPlan } from "./planner";

export interface GeneratedTest {
  file: string;
  title: string;
}

const SYSTEM = `Eres un SDET senior que escribe pruebas E2E con Playwright + TypeScript.
Antes de escribir código:
1. Lee AGENTS.md (convenciones del repo).
2. Lee 1-2 specs existentes en tests/e2e/ para imitar el estilo.
Luego crea el archivo .spec.ts solicitado cumpliendo EXACTAMENTE las convenciones.
No modifiques archivos existentes. No ejecutes comandos.`;

/**
 * Agente generador: Claude Code escribe los specs faltantes directamente
 * en el repo usando sus herramientas Write/Edit.
 */
export async function generateMissingTests(plan: TestPlan): Promise<GeneratedTest[]> {
  const created: GeneratedTest[] = [];

  for (const item of plan.generate) {
    if (!item.file.endsWith(".spec.ts") || item.file.includes("..")) {
      log.warn("generator", `Ruta sospechosa ignorada: ${item.file}`);
      continue;
    }

    const prompt = [
      `Crea el archivo de test "${item.file}" con un único test titulado exactamente:`,
      `"${item.title}"`,
      "",
      "El test debe validar este criterio de aceptación del ticket",
      `${plan.ticket}:`,
      `"${item.criterion}"`,
      "",
      "Contexto de estrategia: " + plan.strategy,
    ].join("\n");

    await askClaude(prompt, {
      system: SYSTEM,
      allowedTools: ["Read", "Write", "Glob", "Grep"],
      permissionMode: "acceptEdits",
      maxTurns: 8,
      cwd: process.cwd(),
    });

    created.push({ file: item.file, title: item.title });
    log.ok("generator", `Spec generado: ${item.file}`);
  }

  return created;
}
