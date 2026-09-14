# AGENTS.md — Repo and agent conventions

## Language policy (MANDATORY)

All generated content MUST be in English:

- Code comments, docstrings, log messages and error messages.
- Documentation (README, guides), including content aimed at Jira
  (bug titles/descriptions, comments) since they are public artifacts.
- Commit messages (imperative mood, conventional-commits style,
  e.g. `feat: add retry policy to decision engine`).
- Test titles and PR descriptions.

Exception: user-provided data (ticket text from Jira) may stay in its original
language; the Gherkin parser accepts Spanish criteria by design.

This repository runs an **Agentic QA workflow**: Claude Code agents take part
in real testing decisions (planning, generation, failure analysis) and close
the loop with **Jira** and **Playwright**.

## Architecture

```
Jira (ticket + Acceptance Criteria)
        │
        ▼
┌─────────────────┐     testing plan         ┌──────────────────┐
│ Planner (Claude) │ ───────────────────────► │ Playwright Runner │
└─────────────────┘                          └────────┬─────────┘
        ▲                     generates specs            │ results + evidence
        │                      (optional)                ▼ (screenshots/video/trace)
┌─────────────────┐   verdict + confidence    ┌──────────────────┐
│ Analyst (Claude) │ ◄─────────────────────── │ Decision Engine   │
└─────────────────┘                           └────────┬─────────┘
                                                       ▼
                                    Jira: bug + evidence / comments / transition
```

## Agent roles

| Agent | File | Tools | Responsibility |
|---|---|---|---|
| **Planner** | `src/agents/planner.ts` | none (pure reasoning) | Maps each ticket acceptance criterion against the spec inventory; decides what to run and what is missing |
| **Generator** | `src/agents/generator.ts` | Read, Write, Glob, Grep | Writes missing `.spec.ts` files following the conventions in this file |
| **Analyst** | `src/agents/analyst.ts` | Read, Glob, Grep | Classifies each failure (`product_bug`, `flaky`, `test_issue`, `environment`) by reading screenshots and code; proposes an action |

The **Decision Engine** (`src/decisions/engine.ts`) combines deterministic
rules with the analyst's verdict:

- `retry` recommended and `MAX_RETRIES` available → automatic test retry.
- `product_bug` with `confidence >= BUG_CONFIDENCE_THRESHOLD` → **creates a Jira bug**
  with screenshot/video/trace attached, links it to the ticket and optionally
  moves the ticket status (`JIRA_TRANSITION_BUG`).
- Everything passed → closing comment on Jira (+ `JIRA_TRANSITION_PASS`).
- Ambiguous cases → informative comment, no automatic bug opening.

## Playwright test conventions

1. Location: `tests/e2e/**/*.spec.ts`.
2. Selectors: use `data-test="..."` attributes via `getByTestId()` (configured
   in `playwright.config.ts` as `testIdAttribute`). Avoid XPath and CSS classes.
3. One `test.describe` per story/feature; descriptive titles reflecting the
   acceptance criterion they validate.
4. No dependencies between tests; each test does its own login/setup (no
   global storageState: the planner needs to run subsets with `--grep`).
5. Web-first assertions (`expect(locator).toHaveX()`), never `waitForTimeout`.
6. UI interactions go through the Page Objects (`tests/e2e/pages/`);
   the shared fixture injects the `PageManager` as `pm`
   (`import { test, expect } from "./fixtures"`).
7. Additional fixtures go in `tests/e2e/fixtures.ts`.

Generating agents MUST read an existing spec before writing a new one to mimic
the style. All new code must pass `npm run lint` and `npm run typecheck`.

## Pipeline conventions

- Artifacts (JSON reports, screenshots, videos, traces, manifest) live in
  `artifacts/<run-id>/`; they are never committed.
- The planner responds ONLY with zod-validated JSON (`src/agents/planner.ts`).
- Every Jira action goes through `src/jira/client.ts` (REST API v3) or its mock.
- `MOCK_JIRA=1` and `DRY_RUN=1` allow exercising the whole flow without
  credentials or an LLM.

## Coding behavior (Karpathy guidelines)

These principles reduce common LLM coding mistakes. Use judgment on trivial
tasks; they bias toward caution over speed. Load the
`karpathy-guidelines` skill for real-world examples.

1. **Think before coding** — Don't assume; state assumptions explicitly and ask
   when uncertain. Present multiple interpretations instead of picking silently.
   Surface tradeoffs and push back when a simpler approach exists.
2. **Simplicity first** — Minimum code that solves the problem. No speculative
   features, single-use abstractions, unwarranted configurability, or error
   handling for impossible scenarios. If 200 lines could be 50, rewrite it.
3. **Surgical changes** — Touch only what the request requires. Don't improve
   adjacent code, comments, or formatting; match existing style. Remove orphans
   YOUR changes created, never pre-existing dead code.
4. **Goal-driven execution** — Define verifiable success criteria and loop until
   verified. Write a failing test first, then make it pass; verify no regressions.
