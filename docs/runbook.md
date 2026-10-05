# Runbook

Use separate application schemas and private Storage buckets for development, staging, and production in the shared Supabase project. `feature/*` is disposable/local test data, `dev` maps to development Preview, `staging` is release rehearsal, and `main` is production. Render a migration at apply time for exactly one environment; the renderer validates that the schema and bucket match that environment, and only the integration release lane applies production migrations.

For a generated shared project, render with `node ops/render-migration.mjs --slug <registry-slug> --environment <dev|stg|prod> --schema <app_<registry-slug>_<env>> --bucket <display-slug>-<env>-private --topology shared`. Dedicated projects use `--schema public --topology dedicated`. CI uses the shorter `--check` and `--apply` forms, which take the slug and topology from `project.profile.json`.

The rendered file pins its own target schema and does not rely on the runner getting `search_path`
right: it sets the search_path, asserts that the target schema exists and that unqualified objects
resolve to it, and schema-qualifies every object. A production rendering applied while the runner
still points at the development schema therefore lands in the production schema or fails loudly; it
can no longer silently hand the development schema to the production member list (R3-05). Pin
`search_path` to the same schema anyway: two defences are better than one.

Keep `pnpm-lock.yaml` committed. Every job of both canonical workflows that installs dependencies begins with `pnpm install --frozen-lockfile`, and `ops/release/record-candidate.mjs` hashes the lockfile into the release identity, so a project without one fails at step one in every job. `node ops/check-standard.mjs` — the `operational_readiness` gate — fails and names the file when it disappears. The run-time records `candidate.json`, `candidate-deployment.json`, `promotion-record.json` and `health.json` are gitignored and must stay that way.

`ops/README.md` lists every script the canonical workflows run and what each refuses to do.
`node ops/check-standard.mjs` is the structural readiness check; it says something about this
repository, never about a provider.

For an incident, inspect `/api/health`, authenticated `/api/ops/ready`, Sentry, and provider status. Roll back only to a known-compatible application release; `ops/rollback.mjs` never restores a database and refuses to run without `--preserve-database`.
