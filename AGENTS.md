# AGENTS.md — Convenciones del repo y de los agentes

Este repositorio ejecuta un **workflow de QA Agéntico**: agentes Claude Code
participan en decisiones reales de testing (planificación, generación, análisis
de fallas) e integran el ciclo con **Jira** y **Playwright**.

## Arquitectura

```
Jira (ticket + Acceptance Criteria)
        │
        ▼
┌─────────────────┐     plan de testing      ┌──────────────────┐
│ Planner (Claude) │ ───────────────────────► │ Playwright Runner │
└─────────────────┘                          └────────┬─────────┘
        ▲                     genera specs            │ resultados + evidencia
        │                      (opcional)             ▼ (screenshots/video/trace)
┌─────────────────┐   veredicto + confianza   ┌──────────────────┐
│ Analyst (Claude) │ ◄─────────────────────── │ Decision Engine   │
└─────────────────┘                           └────────┬─────────┘
                                                       ▼
                                    Jira: bug + evidencia / comentarios / transición
```

## Roles de los agentes

| Agente | Archivo | Herramientas | Responsabilidad |
|---|---|---|---|
| **Planner** | `src/agents/planner.ts` | ninguna (solo razonamiento) | Mapea cada criterio de aceptación del ticket contra el inventario de specs; decide qué ejecutar y qué falta |
| **Generator** | `src/agents/generator.ts` | Read, Write, Glob, Grep | Escribe los `.spec.ts` faltantes siguiendo las convenciones de este archivo |
| **Analyst** | `src/agents/analyst.ts` | Read, Glob, Grep | Clasifica cada falla (`product_bug`, `flaky`, `test_issue`, `environment`) leyendo screenshots y código; propone acción |

El **Decision Engine** (`src/decisions/engine.ts`) combina reglas deterministas
con el veredicto del analista:

- `retry` recomendado y `MAX_RETRIES` disponible → reintento automático del test.
- `product_bug` con `confidence >= BUG_CONFIDENCE_THRESHOLD` → **crea bug en Jira**
  con screenshot/video/trace adjuntos, lo linkea al ticket y opcionalmente mueve
  el ticket de estado (`JIRA_TRANSITION_BUG`).
- Todo pasó → comentario de cierre en Jira (+ transición `JIRA_TRANSITION_PASS`).
- Casos ambiguos → comentario informativo, sin apertura automática de bugs.

## Convenciones para tests Playwright

1. Ubicación: `tests/e2e/**/*.spec.ts`.
2. Selectores: usar atributos `data-test="..."` vía `getByTestId()` (configurado
   en `playwright.config.ts` como `testIdAttribute`). Evitar XPath y clases CSS.
3. Un `test.describe` por historia/feature; títulos descriptivos que reflejen el
   criterio de aceptación que validan.
4. Sin dependencias entre tests; cada test hace su propio login/setup (sin
   storageState global: el planner necesita ejecutar subsets con `--grep`).
5. Assertions web-first (`expect(locator).toHaveX()`), nunca `waitForTimeout`.
6. Interacciones con la UI a través de los Page Objects (`tests/e2e/pages/`);
   la fixture compartida inyecta el `PageManager` como `pm`
   (`import { test, expect } from "./fixtures"`).
7. Fixtures adicionales van en `tests/e2e/fixtures.ts`.

Los agentes generadores DEBEN leer un spec existente antes de escribir uno nuevo
para imitar el estilo. Todo código nuevo debe pasar `npm run lint` y
`npm run typecheck`.

## Convenciones del pipeline

- Los artifacts (reportes JSON, screenshots, videos, traces, manifest) viven en
  `artifacts/<run-id>/`; nunca se commitean.
- El planner responde SOLO JSON validado con zod (`src/agents/planner.ts`).
- Toda acción sobre Jira pasa por `src/jira/client.ts` (REST API v3) o su mock.
- `MOCK_JIRA=1` y `DRY_RUN=1` permiten probar todo el flujo sin credenciales ni LLM.
