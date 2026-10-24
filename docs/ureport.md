# uReport integration

[ureport](https://github.com/ureport-web/ureport-standalone) is a standalone
test-reporting server: it stores builds and test results and computes
cross-build analytics (top failures, slowest tests, pass-rate and build
duration history).

This repo pushes every pipeline run to uReport **after** the run finishes, so
the data uReport receives includes the agentic verdict — the analyst's
classification, its confidence, the Jira bug key that was created and the
acceptance-criteria coverage — next to the raw Playwright outcome.

## Why a post-pipeline push

The official `ureport-playwright-reporter` uploads results *during* the run,
before the analyst has classified anything. By the time the pipeline decides
whether a failure is a product bug, a flaky test or a broken test, the
reporter has already uploaded the run and there is no way to enrich it. This
integration pushes from the pipeline's manifest instead, once the decisions
exist.

It also keeps the Playwright reporter configuration untouched: the pipeline
runs Playwright with `--reporter=json` (a CLI flag that replaces the reporter
list from `playwright.config.ts`), and the uReport payload is built from that
JSON plus the manifest.

## What gets pushed

| uReport field | Source |
|---|---|
| `build` | `Date.parse(manifest.run.startedAt)` — numeric and stable, so re-pushing the same run updates the same build |
| `uid` | `<spec file>::<slug of the test title>` — stable across builds, which is how uReport tracks a test over time |
| `status` | `PASS` / `FAIL` / `SKIP` / `RERUN_PASS` (a flaky test that passed on a retry) |
| `tags` / `components` | the business-risk tags declared in the spec (`@auth`, `@payment`, …); tags keep the `@`, components do not |
| `failure.error_message` | the Playwright error message (ANSI codes stripped, local paths redacted) |
| `failure.stack_trace` | the `at file:line:column` frames (local paths redacted) |
| `failure.token` | the failing assertion position, e.g. `login.spec.ts:32:49` |
| `body[]` | one synthetic step per error; the failure screenshot is attached as base64 **only when `UREPORT_ATTACH_SCREENSHOTS=1`** |
| `info.agentClassification` … `info.jiraBug` | the agentic overlay: classification, confidence, severity, action, rationale and the created Jira bug |
| `info.quickInfo` | Jira ticket, Jira URL and the pipeline run id |
| `extras.*` (build level) | ticket, run id, coverage, criteria count, generated specs, bugs created, verdict counts, average confidence, risk tags, browser projects |

## Security model

uReport receives test evidence: failure messages, stack traces and (optionally)
screenshots of the application under test. That data can contain user-visible
content, internal URLs or source code, so the integration is built to leak as
little as possible.

**Least privilege.** The API token belongs to a dedicated uReport user with the
`operator` role, not to `admin`. The operator role may create and update
tests, builds and relations, but it cannot manage users, change the system
settings, read the audit log or delete builds. Create it once from the admin
account:

```bash
# as admin, with a session cookie
curl -b admin.jar -X POST http://localhost:8080/api/signup \
  -H 'Content-Type: application/json' \
  -d '{"username":"ci-pusher","email":"ci-pusher@example.com","password":"<strong password>","adminCreated":true,"role":"operator"}'
```

Log in as that user and generate its token (`POST /api/token`); put **only**
that token in `UREPORT_API_TOKEN`. The admin token is never used by the
pipeline.

**Transport.** `UREPORT_URL` must use `https`, otherwise the client refuses to
run — the API token travels in the `Authorization` header. Plain HTTP is only
accepted for local hosts (`localhost`, `127.0.0.1`, `::1`,
`host.docker.internal`).

**Redaction.** `UREPORT_REDACT_PATHS=1` (default) replaces the local
repository path with `<repo>` in the error messages and stack traces, so the
developer's home directory and the CI runner's layout are not disclosed. ANSI
escape codes are stripped in any case, since they only add noise to a web
report.

**Attachments are opt-in.** `UREPORT_ATTACH_SCREENSHOTS=0` (default) sends no
image at all. Enable it only when uReport runs on infrastructure you control
and the screenshots are acceptable to store there.

**Bounded in time.** Every request has a 20 s timeout and the whole push
shares a budget (`UREPORT_DEADLINE_MS`, default 60 s). A slow or hanging
uReport can delay the pipeline but never stall it, and the push is
non-fatal: a failure is logged as a warning and the pipeline keeps its exit
code.

**Exposure.** By default the uReport instance is bound to `127.0.0.1` and the
container refuses to start while the admin password is empty or `changeme`
(less than 16 characters in the production file). uReport stores test results
**without a TTL**: they stay until they are purged by hand, so the database is
as sensitive as the evidence it holds. When the instance is public (see
*Deploying a public instance*), only ports 80/443 are exposed and Caddy
terminates TLS; uReport and MongoDB stay on the compose network.

**Residual risks.** Redaction only covers the local repository path. A failure
message can still contain application data (a rendered total, a username, an
internal URL) and the source line of the failing assertion, because that is
the whole point of sharing the failure. Keep uReport on a private network, use
a separate database per environment, and purge old builds periodically.

### Configuration reference

| Variable | Default | Meaning |
|---|---|---|
| `UREPORT_URL` | – | Base URL of the instance. Must be https unless it points at a local host. |
| `UREPORT_API_TOKEN` | – | API token of the `operator` user. |
| `UREPORT_PRODUCT` | `agentic-qa-workflow` | Product lane in uReport. |
| `UREPORT_TYPE` | `E2E` | Build type in uReport. |
| `UREPORT_TEAM` | `QA` | Team shown in uReport. |
| `UREPORT_STAGE` | – | Optional environment name. |
| `UREPORT_ATTACH_SCREENSHOTS` | `0` | Send failure screenshots. Opt-in. |
| `UREPORT_REDACT_PATHS` | `1` | Replace the local repository path with `<repo>`. |
| `UREPORT_DEADLINE_MS` | `60000` | Total budget for one push. |
| `UREPORT_ADMIN_EMAIL` | `admin@example.com` | Seed account of the local server (first start only). |
| `UREPORT_ADMIN_PASSWORD` | – | Password of the local server. The container refuses to start without it. |

## Running a local uReport

The compose file builds uReport straight from the upstream repository, pinned
to a commit so the image is reproducible:

```bash
docker compose --profile ureport up --build -d
```

- UI: <http://localhost:8080/nextgen/login>. The instance is bound to
  `127.0.0.1` only.
- Set `UREPORT_ADMIN_PASSWORD` in `.env` **before the first start** (the
  container refuses to start with an empty or `changeme` password). The
  credentials are only applied on the first start, when the database is
  still empty — later changes to the variable do not rotate the account.
- The root URL (`http://localhost:8080/`) serves uReport's marketing page; the
  app lives under `/nextgen`.

Create the `operator` user and its token (see the security model above), then
configure the repo:

```bash
UREPORT_URL=http://localhost:8080
UREPORT_API_TOKEN=<token of the operator user>
UREPORT_PRODUCT=agentic-qa-workflow
UREPORT_TYPE=E2E
UREPORT_TEAM=QA
```

The push is **non-fatal**: if uReport is unreachable, the pipeline logs a
warning and keeps its exit code. uReport is a reporting sidecar, never a gate.

## Deploying a public instance (for CI)

GitHub Actions cannot reach an instance that runs on a laptop, and it cannot
host one itself: the runner is ephemeral and has no public URL. To have every
CI run visible in uReport, run it on a host with a public https URL — a small
VPS is enough.

Requirements:

- a host with Docker Compose (1 vCPU / 1 GB RAM is plenty for this test volume);
- a public DNS name pointing at it;
- inbound ports 80 and 443 open.

`docker-compose.prod.yml` starts three services: MongoDB, uReport and Caddy.
Caddy obtains a Let's Encrypt certificate for `UREPORT_DOMAIN`, redirects http
to https and sends HSTS; uReport and MongoDB publish no host ports.

### Getting the name for free (DuckDNS)

DuckDNS provides `name.duckdns.org` subdomains at no cost and is on the Public
Suffix List, so the certificate for your subdomain has its own Let's Encrypt
rate-limit bucket instead of sharing one with every other user.

1. Sign in at <https://www.duckdns.org> (GitHub/Google login is supported),
   create a subdomain (up to five) and copy the **account token** from the
   top of the page.
2. On the server, point the name at its public IP and keep it current:

   ```bash
   cat > /etc/duckdns.env <<'EOF'
   DUCKDNS_DOMAIN=agentic-qa
   DUCKDNS_TOKEN=<the token from step 1>
   EOF
   chmod 600 /etc/duckdns.env

   . /etc/duckdns.env
   deploy/duckdns-update.sh          # prints "... now points at this host"

   # follow a dynamic address; harmless when it does not change
   echo '*/5 * * * * . /etc/duckdns.env; /opt/agentic-qa/deploy/duckdns-update.sh >/dev/null 2>&1' \
     | crontab -
   ```

   The script sends an empty `ip` parameter, so DuckDNS records the address
   the request comes from — no need to know the public IP, and it works
   behind NAT as long as only port 80/443 are forwarded. The cron job also
   keeps the free subdomain active.

3. Verify before starting the stack:

   ```bash
   dig +short agentic-qa.duckdns.org     # must print the server's public IP
   ```

Then `UREPORT_DOMAIN=agentic-qa.duckdns.org`. DuckDNS does not support
wildcards, which is fine: Caddy only requests the single hostname.

```bash
# on the server, with the repo checked out (or just these three files)
cat > .env.prod <<'EOF'
UREPORT_DOMAIN=agentic-qa.duckdns.org
UREPORT_ADMIN_EMAIL=admin@example.com
UREPORT_ADMIN_PASSWORD=<at least 16 random characters>
EOF
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Keep `.env.prod` out of version control (it is git-ignored). Like the local
instance, the admin credentials are only applied on the first start, when the
database is empty; changing the variable later does not rotate the account.

Then create the `operator` user against the public URL and generate its token:

```bash
BASE=https://agentic-qa.duckdns.org

curl -c admin.jar -X POST $BASE/api/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<admin password>"}'

curl -b admin.jar -X POST $BASE/api/signup \
  -H 'Content-Type: application/json' \
  -d '{"username":"ci-pusher","email":"ci-pusher@example.com","password":"<strong password>","adminCreated":true,"role":"operator"}'

curl -c op.jar -X POST $BASE/api/login -H 'Content-Type: application/json' \
  -d '{"username":"ci-pusher","password":"<strong password>"}'

curl -b op.jar -X POST $BASE/api/token -H 'Content-Type: application/json' -d '{}'
# → {"apiToken":"…"} — this is the value for UREPORT_API_TOKEN
```

Finally set the repository secrets and variables (see *CI* below) and the
dashboard will link to `https://agentic-qa.duckdns.org/nextgen/overview`.

Check that the certificate was issued (the first request can take a few
seconds while Caddy completes the ACME challenge):

```bash
curl -sSI https://agentic-qa.duckdns.org/nextgen/login | head -1   # HTTP/2 200
```

Operational notes:

- **TLS is mandatory.** Outside localhost the client refuses plain http, and it
  validates the certificate: a self-signed certificate needs
  `NODE_EXTRA_CA_CERTS` on the runner (not recommended). Use a real DNS name;
  Let's Encrypt requires ports 80/443 to be reachable.
- **Why `NODE_ENV=docker` and not `production`:** upstream marks the session
  cookie `Secure` only in `production` and never enables Express' `trust
  proxy`, so behind Caddy the browser would never send the cookie back and the
  login would loop. Caddy provides https + HSTS instead.
- **Backups:** the data lives in the `ureport_mongo` volume. Export it with
  `docker compose -f docker-compose.prod.yml exec -T ureport-db mongodump
  --archive=/tmp/ureport.archive` and copy the file off the host.
- **Rotation:** `POST /api/token` replaces the token (the old one stops working
  immediately); `DELETE /api/token` revokes it. After rotating, update the
  `UREPORT_API_TOKEN` secret.
- **Retention:** uReport never expires tests or builds; schedule a periodic
  purge (or a fresh database) if the volume grows.

## Commands

```bash
npm run ureport:sync       # push every manifest under artifacts/ (backfill)
npm run ureport:analytics  # refresh reporting/ureport-history.json
```

`ureport:sync` re-pushes historical runs — useful when uReport comes up after
the fact. It is safe to re-run: uReport upserts builds and relations by their
natural keys, and the client skips the test insert when the build already
holds results (uReport's `/api/test/multi` always inserts, so pushing the
same manifest twice would duplicate every result and distort the
cross-build analytics).

`ureport:analytics` reads uReport's cross-build analytics and writes
`reporting/ureport-history.json`, which the GitHub Pages dashboard renders
(pass rate per build, build duration, top failures, slowest tests) and links
to the uReport instance. The file is git-ignored: it points at the instance
that generated it, so CI regenerates and publishes it but never commits it.

## CI

`UREPORT_URL` must point at an instance the runner can reach: a laptop is not
enough, so deploy one first (see *Deploying a public instance*). Then set these
repository secrets and variables:

- secret `UREPORT_URL` — base URL of the uReport instance.
- secret `UREPORT_API_TOKEN` — API token of the `operator` user.
- variable `UREPORT_PRODUCT` (default `agentic-qa-workflow`).
- variable `UREPORT_TYPE` (default `E2E`).

```bash
gh secret set UREPORT_URL --body "https://agentic-qa.duckdns.org"
gh secret set UREPORT_API_TOKEN --body "<operator token>"
gh variable set UREPORT_PRODUCT --body "agentic-qa-workflow"
gh variable set UREPORT_TYPE --body "E2E"
```

`ci.yml` pushes each pipeline run to uReport; `dashboard.yml` refreshes
`reporting/ureport-history.json` and publishes it to GitHub Pages next to
`metrics-history.json`. Both are optional: without the secrets, nothing is
pushed and the dashboard simply hides the uReport section.
