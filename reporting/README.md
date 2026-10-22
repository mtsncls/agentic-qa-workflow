# Quality metrics reporting

`npm run report` scans `artifacts/*/manifest.json` (written by every
pipeline run — see `src/workflow/pipeline.ts`) and distills each into a
small, safe-to-commit record in `metrics-history.json`: test pass/fail/flaky
counts, AC coverage, decision-engine actions, analyst classifications and
confidence, and bugs created. Re-running is idempotent — a run with the same
`runId` (its `artifacts/<run-id>` folder name) overwrites its prior entry
instead of duplicating it.

It deliberately leaves out anything bulky or ticket-content-sensitive
(screenshots, traces, error messages, root-cause text) — those stay local to
`artifacts/`, which is gitignored. `metrics-history.json` is meant to be
committed and safe to publish.

`dashboard/index.html` is a static, dependency-free page (Chart.js via CDN)
that reads `metrics-history.json` from the same directory and renders trend
charts, decision/classification breakdowns, and a recent-runs table. Open it
with any static server, e.g.:

    cp reporting/metrics-history.json dashboard/
    npx serve dashboard   # or: python3 -m http.server --directory dashboard

`.github/workflows/dashboard.yml` runs this after CI, commits the updated
history back to `main`, and publishes `dashboard/` + the latest
`metrics-history.json` to GitHub Pages. Enable Pages (Settings → Pages →
Source: GitHub Actions) once, then it updates on every green CI run.

## uReport history

`npm run ureport:analytics` reads the cross-build analytics from
[uReport](../docs/ureport.md) — top failures, slowest tests, pass-rate
history and build durations — into `ureport-history.json`. Unlike
`metrics-history.json` (one entry per pipeline run, derived from the
manifest), these numbers are computed by uReport across every build it knows,
so they answer "which tests fail most often" rather than "how did the last run
go".

The dashboard reads it from the same directory and renders a "Cross-build
analytics" section plus a link to the uReport instance. Unlike
`metrics-history.json`, the file is not committed: it points at the instance
that generated it, so CI regenerates and publishes it to Pages but never
version it. The section stays hidden when the file is absent (no uReport
configured).

## Business-risk tags

Generic "X% coverage" hides *what* is at risk. Every run is also rolled up by
**business-risk tag** so the dashboard can show health per exposure area
(`auth`, `payment`, `checkout`, `cart`, `revenue`, `pii`, `critical`,
`regression`, `navigation`, `performance` — see `src/risk.ts`).

Tags come from two merged sources per coverage entry:

- **Jira acceptance criteria** — parsed from the criterion text by
  `src/jira/acceptance.ts`:
  - bracketed: `- [auth][pii] El usuario puede...`
  - keyword: `- risk: auth, payment El usuario puede...`
  - marker: `- @auth #payment El usuario puede...`
- **Playwright tests** — declared via the `tag` metadata (picked up by
  `src/playwright/runner.ts` `collectSpecTags`):

  ```ts
  test.describe("Checkout", { tag: ["@checkout", "@payment", "@revenue", "@critical"] }, () => { ... });
  ```

The planner (`src/agents/planner.ts`) unions both into each `coverage[].tags`,
the pipeline manifest carries them through to `run.results[].tags`, and
`src/reporting/metrics.ts` aggregates them into `RunMetrics.risk` (criteria
covered/missing, passed/failed/flaky, bugs, avg analyst confidence). The
dashboard renders a per-tag stacked bar plus a risk table.

