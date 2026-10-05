# Generated-project release helpers

The generator copies this directory to the generated project's `ops/release/`. These files are
self-contained because a generated project does not contain this monorepo's `packages/core` tree or
`standard/` directory — and because the jobs that run them only check the repository out, they
import `node:` builtins and their own siblings and nothing else (R3-04).

`validate-workflows.mjs`, `run-gate.mjs`, `vitest.gate.config.mjs`, `release-controls.test.mjs`,
`secret-scan.mjs`, `promotion-record.mjs`,
`record-promotion.mjs`, `select-staging-record.mjs`, `record-candidate.mjs`, `record-deployment.mjs`,
`release-policy.mjs`, `required-gates.mjs`, `gate-results.mjs`, `rollback-payload.mjs`,
`health-outputs.mjs` and `check-project-scripts.mjs` are **byte-identical** to their `ops/release/`
originals.

## One gate runner (D-025)

Every `run:` step of `ci.yml` and `release.yml` that runs a gate or an ops script is
`node ops/release/run-gate.mjs <gate>` and nothing else. The gate's program and arguments live in
`ops/release/gates.json` as an argv **array**, and the runner executes that array directly:

- **no shell and no package-manager script layer.** The ninth review added one `pnpm-workspace.yaml`
  with `scriptShell: /usr/bin/true` to a generated project and every `pnpm run <gate>` became exit 0
  with `package.json` byte-identical. Nothing in the project read that file. The runner now refuses
  **every** gate when a root-level package-manager or tool configuration file is not declared in
  `gates.json`: `pnpm-workspace.yaml`, `.npmrc`, `.pnpmfile.*`, `vitest.config.*`,
  `vitest.workspace.*`, `vite.config.*`, `tsconfig*.json`, `.env*`, `package.json`,
  `eslint.config.*`, `next.config.*`, `.nvmrc`, `.node-version`. The pattern list is a constant of
  `run-gate.mjs`, so `gates.json` can say what is *allowed* and can never widen what is looked for.
  The `controls` gate runs in `workflow-validation` and `ci-workflow-validation` — the checkout-only
  jobs every other job needs — so such a file is refused **before** any `pnpm install` has read it.
- **no `--` separator.** pnpm 11.9.0 forwards it, and the delivered ops scripts refuse an unknown
  token, so the required `migrations` gate used to exit 1 with `Invalid argument --` on every run and
  the whole production lane failed on its first argument.
- **an explicit `--config` on every test gate**, pointing at the digest-pinned
  `ops/release/vitest.gate.config.mjs`, which forbids `passWithNoTests`. A green test gate also has
  to report **at least** `minimumTests` collected and passed, from the run's own JSON report, so it
  proves execution rather than the existence of a file. Raise those floors in your project as its
  suite grows.
- **`node` is the interpreter already running**, and `vitest`/`tsc`/`eslint`/`next` are resolved from
  the installed package's own `bin` entry by **real path**, refused if that path leaves this
  repository's `node_modules`. A `node` entry in `node_modules/.bin` — which `pnpm run` used to put
  in front of `PATH` — is on no path the gate takes.

`pnpm install --frozen-lockfile` stays a step of its own: a gate cannot install its own dependencies.
`dependency_scan` is the one gate whose program (`pnpm`) comes from `PATH`, because a repository
cannot supply the program that installs it; the runner refuses a `pnpm` whose real path lies inside
this repository.

`check-project-scripts.mjs` refuses a workflow that still spells a gate as `pnpm run`, `pnpm exec`,
`pnpm vitest`, `pnpm -r` or with a bare `--`, requires every gate a workflow names to exist in
`gates.json`, requires every gate marked `required` to be run by a workflow, and requires the pinned
`package-scripts.json` body and the declared gate argv to describe the same program.
`ops/release/release.test.mjs` — a test of the **platform monorepo**, not of this project — fails
when any of them drifts and runs the adversarial workflow fixtures against both copies. What that
proves is about the delivery: the code a generated project receives is the code those fixtures ran
against at delivery time. It proves nothing about this repository afterwards; anyone who can commit
here can edit these files, and no gate in this project re-checks them against the platform.

`check-promotion.mjs`, `evaluate-gates.mjs` and `decide-rollback.mjs` differ only in which core
contract module they import; the same test suite runs both CLIs over identical fixtures and compares
stdout and exit code.

`workflow-templates/` is the canonical workflow set for a generated project (D-014): it is
byte-identical to `starter/ci/workflows/`, which is what the generator copies into
`.github/workflows/`.

What `validate-workflows.mjs` proves, exactly:

1. **Names.** Only `ci.yml` and `release.yml` may exist under `.github/workflows/` or under
   `ops/release/workflow-templates/`. That list is a constant of the standard inside
   `release-policy.mjs`, checked before any digest, so a commit that adds
   `.github/workflows/rogue.yml` **together with** a matching template **and** a regenerated
   `workflow-templates.sha256` is refused by name — which is the exact path that used to pass
   (R5-01, measured: it exited 0 before this change).
2. **Capability.** Only `release.yml` may select `environment: production`, read a production-class
   secret, run a production deploy command or ask for a write permission, and inside it only its
   canonical production jobs may. No workflow other than `release.yml` may declare a job whose id is
   one of the required gate names, and a required gate whose steps run nothing (`run: "true"`) is
   not a gate.
3. **Structure.** Every canonical template is parsed and analysed — production jobs classified by
   effect, full gate closure, no `continue-on-error`, no non-blocking or disjunctive `if:`,
   least-privilege permissions, no untrusted-trigger secrets, no reusable workflow, no
   repository-local action.
4. **Integrity.** Every canonical template matches `ops/release/workflow-templates.sha256`, and
   every file under `.github/workflows/` is byte-identical to a rendering of a pinned, analysed
   template.
5. **Provenance.** `ops/release/workflow-templates.sha256` and `ops/release/global-policy.yaml` were
   delivered with this project, so the gate recomputes their combined digest and compares it with
   the digest the standard pinned for the `templateVersion` recorded in
   `.project-launch-starter.json`. Editing the manifest, a template and the policy together in one
   commit fails against that pin.

   **This rule depends on `.project-launch-starter.json`, and it fails closed (R6REL-01).** The
   sixth review deleted that one file: the rule used to read its absence as "not a generated
   project" and switch itself off, and a project whose delivered policy had been cut to a single
   gate then validated clean. Whether this repository is a generated project is decided by the
   delivered layout instead — the control files the generator writes into `ops/release/`
   (`global-policy.yaml`, `core-can-promote.mjs`, `core-evaluate-gates.mjs`,
   `core-decide-rollback.mjs`), which the platform monorepo does not have; the monorepo is
   recognised by its own sources (`standard/policy/`, `starter/`).

   A generated project without a readable `.project-launch-starter.json` fails this gate, naming the file.

   Missing, renamed, unparseable, without a `templateVersion` or without the `releaseControlsSha256`
   the generator stamped — each is an error, none is an exemption. A tree that carries both layouts,
   or neither, is refused rather than validated as whichever is convenient. **Keep this file
   committed**, and keep it under code-owner review: `ops/release/branch-protection.plan.json` lists it.
6. **The required gate set.** `release.required_gates` in `ops/release/global-policy.yaml` decides
   which gates every production job must depend on, and it is data in this repository. The
   canonical set is pinned in `release-policy.mjs` (`CANONICAL_REQUIRED_GATES`): this project's
   policy may require MORE than the standard and may never require less. That rule reads no
   manifest and no digest, so it also fails on a downgraded policy in a project whose launch
   manifest has been removed or whose pin has been rewritten.

**What it does not prove.** It is not a defence against someone who can commit anything to this
repository: that person can edit this delivered gate itself, and no gate in this project re-checks
these files against the platform. What is removed is the class of downgrade that needs no diff in a
control file at all. Branch protection and review carry the rest — see
`ops/release/branch-protection.plan.json`, which also lists the paths that should require code-owner
review.

`node ops/check-standard.mjs` (the `operational_readiness` gate of `release.yml`) independently
fails when `.github/workflows/` holds anything besides `ci.yml` and `release.yml`. That gate is not
a job of `ci.yml`.

`package-scripts.json`, `secret-scan.allowlist` and `global-policy.yaml` are per-project
configuration. `package-scripts.json` is byte-identical to `starter/ci/package-scripts.json` and
lists the package scripts and test directories the canonical workflows call;
`check-project-scripts.mjs` verifies them in the `workflow-validation` gate.
