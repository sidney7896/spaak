# Operations

The scripts in this directory are the application-side half of the release lane. Every script the
canonical workflows (`.github/workflows/ci.yml`, `.github/workflows/release.yml`) call exists here
and in `package.json`; `ops/release/check-project-scripts.mjs` fails the `workflow-validation` gate
if that ever stops being true.

| script | file | what it does |
|---|---|---|
| `migration:check` | `render-migration.mjs --check` | renders the migration for one environment and validates it; applies nothing |
| `migration:apply` | `render-migration.mjs --apply` | renders and hands the file to `psql`; refuses without `DATABASE_URL` |
| `check:standard` | `check-standard.mjs` | structural readiness check of manifest, profile, `.env.example`, workflows, migration and release scripts |
| `build:production` | `build-production.mjs` | production build; consumes `--no-domain-assignment` and requires `APP_ENV=production`; with `--deployment-url-file <path>` it also creates the candidate deployment and records it |
| `smoke:production` | `smoke.mjs` | bounded read-only requests against the deployment; refuses without `PRODUCTION_SMOKE_URL` |
| `health:production` | `health.mjs` | bounded post-promotion checks, writes `health.json` in the shape `ops/release/health-outputs.mjs` requires |
| `promote:production` | `promote.mjs` | promotes an already verified build; refuses without `--verified-build` and a provider token |
| `rollback:app` | `rollback.mjs` | application-only rollback; `--preserve-database` is mandatory and no code path touches the database |

## Rendering a migration

```sh
node ops/render-migration.mjs --slug <registry-slug> --environment <dev|stg|prod> \
  --schema app_<registry-slug>_<env> --bucket <display-slug>-<env>-private --topology shared
```

Dedicated projects use `--schema public --topology dedicated`. In `--check` and `--apply` mode the
slug and topology come from `project.profile.json` and only `--environment`/`--schema` are passed,
so CI cannot check one project's schema against another project's identity.

The rendered file pins its own target schema: it sets `search_path`, asserts that the schema exists
and that unqualified objects resolve to it, and schema-qualifies every object. A rendering applied
with the wrong `search_path` therefore raises instead of building the wrong environment's schema
(R3-05). `ops/.rendered/` holds the files `--apply` produces and is gitignored.

## The candidate deployment

The release workflow's `production-build` job runs:

```sh
pnpm run build:production -- --no-domain-assignment --deployment-url-file candidate-deployment.json
```

With that flag the script does two things. It runs the ordinary production build, and it creates the
**candidate deployment** the rest of the release path is about, with the documented deploy command:

```sh
vercel deploy --prod --skip-domain --yes      # the deployment URL is this command's stdout
vercel inspect <deployment url>               # the deployment id promote:production promotes
```

`--skip-domain` is what makes this a production-configured build *without* public traffic: no domain
is assigned and nothing is promoted here. Promotion is `promote:production`'s decision, taken after
the smoke gate, and it is taken nowhere else.

It then writes `{"url": "https://…", "id": "dpl_…"}` to the given path.
`ops/release/record-deployment.mjs` validates that record and publishes `deployment_url` and
`deployment_id` as job outputs; `smoke` targets that URL and `promote-production` promotes that id.
Before this existed, the smoke gate read a static repository variable and therefore exercised the
still-live *previous* production — the deployment the promotion was about to replace.

Credentials are read from the environment, never from the argument list: `VERCEL_TOKEN`,
`VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` must all be present. Every failure is a refusal that writes
no record — a missing credential, a deploy command that exited non-zero, stdout that is not a
deployment URL, an `https`-less URL, or a lookup that reported no deployment id. A record left by an
earlier attempt is deleted *before* the deploy command runs, so a failed build can never leave a
previous candidate behind for the smoke gate to verify and the promotion to promote. A build that
could not deploy fails the release instead of handing the smoke gate a URL nobody produced.

## What these scripts do not prove

Everything in this directory is either structural or a bounded request against a live deployment.
A green `check:standard` is evidence about the repository, never about a provider. `migration:apply`
reports what `psql` returned; if `psql` cannot start, the run fails rather than reporting success.
`build:production --deployment-url-file` reports what the deploy command returned: the tests drive a
stand-in runner, so they prove which command would run, which credential is refused and which
answers are rejected — never that a real deployment was created.
