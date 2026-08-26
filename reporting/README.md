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
