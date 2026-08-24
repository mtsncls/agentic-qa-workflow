# Agentic QA Workflow

Integración real entre **Claude Code**, **Playwright** y **Jira** dentro de un
workflow de QA Automation / Agentic Testing. Los agentes no solo ejecutan
pruebas: planifican, generan tests, analizan evidencia real (screenshots,
traces) y toman decisiones automatizadas que terminan en acciones concretas en
Jira.

## Flujo completo

```
Jira / Acceptance Criteria
        │  (REST API v3)
        ▼
Planner agéntico (Claude Code SDK)
        │  plan de testing JSON validado + specs faltantes
        ▼
[Generator] ──opcional──► escribe .spec.ts nuevos en el repo
        ▼
Playwright Runner ──► resultados + screenshots + video + trace
        ▼
Analyst agéntico (Claude lee la evidencia)
        │  clasificación: product_bug | flaky | test_issue | environment (+ confianza)
        ▼
Decision Engine (reglas + veredicto del agente)
        │  retry automático · abrir bug · comentar · escalar
        ▼
Jira: bug con evidencia adjunta · link al ticket · comentario · transición
```

## Estructura

```
src/
├── agents/
│   ├── claude.ts        # Wrapper sobre @anthropic-ai/claude-agent-sdk
│   ├── planner.ts       # AC ↔ inventario de tests → plan JSON (zod)
│   ├── generator.ts     # Genera specs faltantes (Claude escribe en el repo)
│   └── analyst.ts       # Diagnóstico de fallas leyendo evidencia real
├── jira/
│   ├── client.ts        # REST API v3 (issues, comentarios, adjuntos, links, transiciones)
│   ├── mock.ts          # Jira simulado en memoria (MOCK_JIRA=1)
│   ├── acceptance.ts    # Extracción/parsing de criterios de aceptación
│   └── reporter.ts      # Bug creation con evidencia + comentarios de cierre
├── playwright/
│   ├── runner.ts        # Ejecuta `playwright test` y parsea el reporte JSON
├── decisions/
│   └── engine.ts        # Reglas deterministas + veredicto LLM → acciones
├── workflow/
│   └── pipeline.ts      # Orquestación end-to-end + manifest de auditoría
└── index.ts             # CLI (commander)
tests/e2e/               # Suite E2E contra saucedemo.com
├── pages/               # Page Object Model (LoginPage, ProductsPage, CartPage,
│                        #   CheckoutPage, PageManager) — selectores data-test/getByTestId
├── fixtures.ts          # Fixture compartida: inyecta PageManager como `pm`
├── login.spec.ts        # ACs de autenticación (3 tests)
├── cart.spec.ts         # Carrito + logout (3 tests)
├── checkout.spec.ts     # Flujo completo de compra
└── demo-fail.spec.ts    # Falla simulada para demostrar creación de bugs
.github/workflows/ci.yml # Lint+typecheck, E2E chromium, nightly firefox, smoke del pipeline
artifacts/<run-id>/      # Evidencia: pw-report.json, screenshots, video, trace, manifest
```

El suite E2E unifica lo mejor de dos proyectos previos del portfolio:
[`playwright-saucedemo`](https://github.com/mtsncls/playwright-saucedemo)
(POM, ESLint/Prettier, Allure, CI multi-browser) y los specs de este repo.

## Requisitos

- Node.js ≥ 20
- Una API key de Anthropic ([console.anthropic.com](https://console.anthropic.com/settings/keys))
- Jira Cloud con API token ([crear token](https://id.atlassian.com/manage-profile/security/api-tokens)) — o `MOCK_JIRA=1` para probar sin Jira

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env       # completa tus credenciales
npm run typecheck          # sanity check
```

## Uso

```bash
npm run lint            # ESLint (incluye reglas de Playwright)
npm run typecheck       # TypeScript
npm run test:e2e        # suite E2E local (chromium + reporte HTML/Allure)
npm run allure:serve    # genera y abre el reporte Allure
MOCK_JIRA=1 DRY_RUN=1 npm run qa -- run -t QA-101   # pipeline sin credenciales
```

CI (`.github/workflows/ci.yml`): quality gate (lint+typecheck) → E2E chromium
en cada push/PR → matriz nightly con firefox → smoke del pipeline agéntico
(mock Jira + dry-run, sin secrets). Dependabot semanal para npm y actions.

### Demo completa sin credenciales (recomendado primero)

```bash
# Todo pasa: comentario de cierre en Jira (mock)
MOCK_JIRA=1 DRY_RUN=1 npm run qa -- run -t QA-101

# Simula una regresión: falla → análisis → BUG creado en Jira (mock) con evidencia
MOCK_JIRA=1 DRY_RUN=1 DEMO_FAIL=1 npm run qa -- run -t QA-101
```

En modo mock verás en consola cada acción "hecha en Jira": bug `QA-201`
creado con screenshot/video/trace adjuntos, link `Blocks → QA-101`,
comentarios y transiciones.

### Con Jira y Claude reales

```bash
npm run qa -- jira-check              # valida credenciales
npm run qa -- plan -t SCRUM-42       # solo el plan de testing (JSON)
npm run qa -- run -t SCRUM-42        # pipeline completo
npm run qa -- run -t SCRUM-42 -g     # + genera specs para criterios sin cobertura
```

El ticket debe tener los criterios de aceptación como viñetas (`-`) en su
descripción (o en el customfield configurado en `JIRA_AC_FIELD`).

## Decisiones automatizadas

| Situación detectada | Acción automática |
|---|---|
| Falla posiblemente transitoria (`flaky`, `environment`) | Reintento hasta `MAX_RETRIES`; si pasa → marcada flaky + comentario |
| `product_bug` con confianza ≥ `BUG_CONFIDENCE_THRESHOLD` | **Bug en Jira** con screenshot/video/trace, link al ticket y transición opcional |
| `product_bug` con baja confianza | Comentario informativo, sin apertura automática |
| `test_issue` / `environment` confirmados | Comentario en el ticket con causa raíz y sugerencia |
| Todo pasó | Comentario de cierre + transición opcional (`JIRA_TRANSITION_PASS`) |

Cada corrida deja un `manifest.json` auditable en `artifacts/<run-id>/`.

## Integraciones alternativas con Jira

Además del cliente REST v3 incluido (`src/jira/client.ts`), puedes enchufar el
**MCP de Atlassian** a los agentes Claude. Ver `mcp.jira.example.json`. El
wrapper del SDK (`src/agents/claude.ts`) soporta pasarle servidores MCP vía la
opción `mcpServers` del `query()`.

## Notas de seguridad

- Nunca commitear `.env` (ya está en `.gitignore`).
- El agente Generator corre con `permissionMode: acceptEdits` limitado a
  herramientas de lectura/escritura de archivos; no tiene Bash.
- Toda respuesta de LLM se valida con zod antes de usarse.
