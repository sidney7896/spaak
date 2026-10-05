# Handoff

This project was created from the Project Launch Standard starter template. Replace unresolved values in `PROJECT_MANIFEST.yaml` through the registry workflow, then configure each logical environment independently. Copying a newer template does not update this project automatically.

Before production, verify Supabase OAuth and custom SMTP, private Storage policies, environment isolation, Sentry/PostHog consent, backups, migration evidence, and the release gates in `docs/runbook.md`.

`pnpm-lock.yaml` must stay committed. Every job of both canonical workflows that installs dependencies starts with `pnpm install --frozen-lockfile`, which fails outright without it, and `ops/release/record-candidate.mjs` folds the lockfile hash into the release identity. `node ops/check-standard.mjs` fails when the file is gone, so the cause is named instead of showing up as `ERR_PNPM_NO_LOCKFILE` in every job.

`candidate.json`, `candidate-deployment.json`, `promotion-record.json` and `health.json` are the opposite: they are written by one release run and are gitignored. `candidate-deployment.json` identifies the deployment that run created — the one the pre-promotion smoke test targets and the promotion promotes — so a committed copy would be a stale promotion target.
