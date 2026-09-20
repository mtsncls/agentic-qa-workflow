# Agentic QA Workflow

Real integration between **Claude Code**, **Playwright** and **Jira** within a
QA Automation / Agentic Testing workflow. The agents don't just run tests: they
plan, generate tests, analyze real evidence (screenshots, traces) and make
automated decisions that end up as concrete actions in Jira.

## Full flow

```
Jira / Acceptance Criteria
        │  (REST API v3)
        ▼
Agentic Planner (Claude Code SDK)
        │  JSON test plan validated + missing specs
        ▼
[Generator] ──optional──► writes new .spec.ts files into the repo
        ▼
Playwright Runner ──► results + screenshots + video + trace
        ▼
Agentic Analyst (Claude reads the evidence)
        │  classification: product_bug | flaky | test_issue | environment (+ confidence)
        ▼
Decision Engine (rules + agent verdict)
        │  automatic retry · open bug · comment · escalate
        ▼
Jira: bug with attached evidence · link to ticket · comment · transition
```

## Structure

```
src/
├── agents/
│   ├── model.ts        # Provider-agnostic LLM client (OpenAI-compatible: OpenRouter/OpenAI/Ollama)
│   ├── planner.ts       # AC ↔ test inventory → JSON plan (zod)
│   ├── generator.ts     # Generates missing specs (LLM writes into the repo)
│   └── analyst.ts       # Failure diagnosis reading real evidence
├── jira/
│   ├── client.ts        # REST API v3 (issues, comments, attachments, links, transitions)
│   ├── mock.ts          # In-memory simulated Jira (MOCK_JIRA=1)
│   ├── acceptance.ts    # Acceptance criteria extraction/parsing
│   └── reporter.ts      # Bug creation with evidence + closing comments
├── playwright/
│   ├── runner.ts        # Runs `playwright test` and parses the JSON report
├── decisions/
│   └── engine.ts        # Deterministic rules + LLM verdict → actions
├── workflow/
│   └── pipeline.ts      # End-to-end orchestration + audit manifest
└── index.ts             # CLI (commander)
tests/e2e/               # E2E suite against saucedemo.com
├── pages/               # Page Object Model (LoginPage, ProductsPage, CartPage,
│                        #   CheckoutPage, PageManager) — data-test/getByTestId selectors
├── fixtures.ts          # Shared fixture: injects PageManager as `pm`
├── login.spec.ts        # Authentication ACs (3 tests)
├── cart.spec.ts         # Cart + logout (3 tests)
├── checkout.spec.ts     # Full purchase flow
└── demo-fail.spec.ts    # Simulated failure to demonstrate bug creation
.github/workflows/ci.yml # Quality gate, chromium E2E, nightly firefox, pipeline smoke, daily real run
.gitignore
Dockerfile / .dockerignore / docker-compose.yml  # Optional containerized execution
artifacts/<run-id>/      # Evidence: pw-report.json, screenshots, video, trace, manifest
```

The E2E suite unifies the best of two previous portfolio projects:
[`playwright-saucedemo`](https://github.com/mtsncls/playwright-saucedemo)
(POM, ESLint/Prettier, Allure, multi-browser CI) and this repo's original specs.

## Requirements

- Node.js ≥ 20
- An LLM provider key — OpenRouter is free ([openrouter.ai/keys](https://openrouter.ai/keys), free models like `deepseek/deepseek-chat:free`) and OpenAI-compatible; or OpenAI / a local Ollama. Configure `LLM_API_KEY`, `LLM_BASE_URL` and `LLM_MODEL` in `.env`.
- Jira Cloud with an API token ([create token](https://id.atlassian.com/manage-profile/security/api-tokens)) — or `MOCK_JIRA=1` to try without Jira

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env       # fill in your credentials
npm run typecheck          # sanity check
```

## Docker (optional)

Reproducible environment: the same Node + Playwright browsers + system deps used
by CI, no local toolchain required.

```bash
docker compose build                                        # build the image
docker compose --profile e2e run --rm e2e                   # run the E2E suite
docker compose --profile pipeline run --rm pipeline         # full pipeline (reads .env)
JIRA_TICKET=SCRUM-42 docker compose --profile pipeline run --rm pipeline  # different ticket
MOCK_JIRA=1 DRY_RUN=1 docker compose --profile pipeline run --rm pipeline # no credentials
```

- The repo is bind-mounted: test evidence and `artifacts/` land on the host and
  code edits apply without rebuilding. `node_modules` stays container-only (the
  image's Linux-built dependencies are used, not the host's).
- Runs as the image's non-root user (`pwuser`) so Chromium's sandbox stays
  enabled; `shm_size` is raised since Playwright needs it.
- The pipeline container receives your credentials through `env_file: .env`.

## Usage

```bash
npm run lint            # ESLint (includes Playwright rules)
npm run typecheck       # TypeScript
npm run test:e2e        # local E2E suite (chromium + HTML/Allure report)
npm run allure:serve    # generates and opens the Allure report
# Tag tests by business risk (see src/risk.ts) so the dashboard rolls up per area:
#   test('...', { tag: ['@auth', '@critical'] }, ...)  or  - [auth][pii] in Jira AC text
MOCK_JIRA=1 DRY_RUN=1 npm run qa -- run -t QA-101   # pipeline without credentials
```

CI (`.github/workflows/ci.yml`): quality gate (lint+typecheck) → chromium E2E
on every push/PR → nightly firefox matrix → agentic pipeline smoke
(mock Jira + dry-run, no secrets needed) → **daily agentic pipeline** at
03:00 UTC (currently mock Jira + dry-run; set the `LLM_API_KEY`,
`JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` secrets and remove the mock
flags in `agentic-pipeline-daily` to run real mode; target ticket via the
`JIRA_TICKET` repo variable, defaults to `QA-101`). Weekly Dependabot for npm
and actions.

The `Quality dashboard` workflow (`.github/workflows/dashboard.yml`) runs after
each green CI run: it aggregates `artifacts/*/manifest.json` into
`reporting/metrics-history.json` (idempotent by run id) and publishes both the
agentic metrics dashboard and the Allure test report to GitHub Pages. Enable
Pages once (**Settings → Pages → Source: "GitHub Actions"**), then both update
automatically.

## Live reports (GitHub Pages)

| Report | URL |
|---|---|
| Agentic quality dashboard (KPIs, decision/classification trends) | [agentic-qa-workflow](https://mtsncls.github.io/agentic-qa-workflow/) |
| Allure execution report (steps, retries, attachments) | [agentic-qa-workflow/allure](https://mtsncls.github.io/agentic-qa-workflow/allure/) |

Local preview:

```bash
npm run report
cp reporting/metrics-history.json dashboard/
npx serve dashboard          # or: python3 -m http.server --directory dashboard
npm run allure:serve         # opens the local Allure report
```

### Full demo without credentials (recommended first)

```bash
# Everything passes: closing comment on Jira (mocked)
MOCK_JIRA=1 DRY_RUN=1 npm run qa -- run -t QA-101

# Simulates a regression: failure → analysis → BUG created in Jira (mocked) with evidence
MOCK_JIRA=1 DRY_RUN=1 DEMO_FAIL=1 npm run qa -- run -t QA-101
```

In mock mode you will see every "action done in Jira" printed on the console:
bug `QA-201` created with screenshot/video/trace attached, `Blocks → QA-101`
link, comments and transitions.

### With real Jira and an LLM

```bash
npm run qa -- jira-check              # validates credentials
npm run qa -- plan -t SCRUM-42       # only the testing plan (JSON)
npm run qa -- run -t SCRUM-42        # full pipeline
npm run qa -- run -t SCRUM-42 -g     # + generates specs for uncovered criteria
```

The ticket must have its acceptance criteria as bullets (`-`) in the
description (or in the custom field configured via `JIRA_AC_FIELD`).

## Automated decisions

| Detected situation | Automatic action |
|---|---|
| Possibly transient failure (`flaky`, `environment`) | Retry up to `MAX_RETRIES`; if it passes → marked flaky + comment |
| `product_bug` with confidence ≥ `BUG_CONFIDENCE_THRESHOLD` | **Jira bug** with screenshot/video/trace, link to ticket and optional transition |
| `product_bug` with low confidence | Informative comment, no automatic bug opening |
| Confirmed `test_issue` / `environment` | Comment on the ticket with root cause and suggestion |
| Everything passed | Closing comment + optional transition (`JIRA_TRANSITION_PASS`) |

Every run leaves an auditable `manifest.json` under `artifacts/<run-id>/`.

## Alternative Jira integrations

Besides the included REST v3 client (`src/jira/client.ts`), the previous
implementation could plug the **Atlassian MCP server** into the Claude agents
(see `mcp.jira.example.json`). The current provider-agnostic client
(`src/agents/model.ts`) is a plain OpenAI-compatible chat backend and does not
drive MCP tools; all evidence is passed inline in the prompts.

## Security notes

- Never commit `.env` (already gitignored).
- The Generator agent runs with `permissionMode: acceptEdits`, restricted to
  read/write file tools; it has no Bash access.
- Every LLM response is validated with zod before being used.
