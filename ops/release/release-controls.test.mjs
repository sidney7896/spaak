// THE DELIVERED SELF-TEST OF THE RELEASE CONTROLS (R7REL-02, R8REL-01, R8REL-03, R8REL-05).
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/release-controls.test.mjs and is
// delivered into every generated project as `ops/release/release-controls.test.mjs`, where
// `.github/workflows/ci.yml` runs it as the required `ci-release-controls` check.
//
// WHY IT EXISTS. Until the seventh review the release path was test-free in the only repository
// where it is the last line of defence. A generated project received fourteen release CLIs and not
// one test over them, so a single line in a shared helper - `return false` in `isEntrypoint` -
// turned the workflow validator, the secret scan, the gate evaluation, the promotion check, the
// candidate record and the rollback decision into silent `exit 0`s, with an empty log and a green
// pipeline. Each CLI now carries its own real-path check, and this file is what makes a neutered
// one visible: every delivered CLI is invoked on a fixture it MUST refuse, and the project's own
// CI turns red when any of them reports success instead.
//
// R8REL-01. The eighth review found the same defect one directory up: the six PROJECT ops scripts
// (`ops/smoke.mjs`, `ops/health.mjs`, `ops/promote.mjs`, `ops/rollback.mjs`,
// `ops/render-migration.mjs`, `ops/check-standard.mjs`) still shared one `ops/entrypoint.mjs`, so
// one line there silenced the pre-promotion smoke, the post-promotion health, the promotion, the
// rollback and the `migrations` and `operational_readiness` gates at once - in a file under no
// code-owner path and covered by no delivered test. The shared helper is gone, and those six
// scripts are exercised here too, exactly like the release CLIs.
//
// R8REL-03. A green `ci-release-controls` did not prove this file had run: `const installed = false`
// left sixteen of seventeen cases skipped and vitest still exited 0. The first case below computes
// this file's own digest and requires it to be the one `check-project-scripts.mjs` pins - and that
// gate, which is required in both canonical workflows and which every other job needs, makes the
// same comparison from its side. Neither file can be changed without the other, and an edit to
// this one that nobody pinned fails `workflow-validation` rather than passing quietly here.
//
// It is deliberately self-contained: node: builtins and vitest only, no import from the repository
// it is checking, no network, no provider. Every fixture is a throwaway directory under the
// system temp directory - which on macOS is reached through a symlink (/var -> /private/var), so
// these runs also prove the real-path check survives a symlinked workspace.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const selfPath = fileURLToPath(import.meta.url);
const controlsDirectory = dirname(selfPath);
const repositoryRoot = resolve(controlsDirectory, '../..');
/**
 * Where this copy is installed. In a generated project - and in the standard's own ops/release/ -
 * the controls live at `ops/release/`, which is the only layout these fixtures describe. The
 * standard also keeps the DELIVERY copy at `starter/ci/ops-release/`; that copy is a payload, not
 * an installation, and is exercised by the generated-project tests in ops/release/release.test.mjs.
 */
const location = relative(repositoryRoot, controlsDirectory).split('\\').join('/');
const installed = location === 'ops/release';

/** The release policy this repository has, wherever it keeps it (delivered copy or the standard's). */
function policyText() {
  for (const candidate of [join(controlsDirectory, 'global-policy.yaml'), join(repositoryRoot, 'standard/policy/global-policy.yaml')]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  throw new Error('no release policy found beside the controls or under standard/policy/');
}

/**
 * R8REL-01. The project's own ops scripts. In a generated project they are `ops/`; in the standard
 * itself the same files are the payload at `starter/template/ops/`, so both copies of this file run
 * these cases against real scripts instead of skipping them where they are not installed.
 */
function projectOpsDirectory() {
  for (const candidate of [join(repositoryRoot, 'ops'), join(repositoryRoot, 'starter/template/ops')]) {
    if (existsSync(join(candidate, 'smoke.mjs'))) return candidate;
  }
  throw new Error('no project ops scripts found at ops/ or starter/template/ops/');
}

/**
 * A high-confidence token the secret scan must report. It is assembled at run time from two halves
 * so that THIS file never contains a value its own detector would match - a test that plants a
 * literal secret makes every secret scan of the repository fail on the test itself.
 */
const PLANTED_TOKEN = ['AKIA', 'QYFAKEFIXTURE000'].join('');

const fixtures = [];

function fixture(name) {
  const directory = mkdtempSync(join(tmpdir(), `release-controls-${name}-`));
  fixtures.push(directory);
  mkdirSync(join(directory, 'ops'), { recursive: true });
  cpSync(controlsDirectory, join(directory, 'ops/release'), { recursive: true });
  // In a generated project the promotion, gate and rollback contracts are the delivered
  // `core-*.mjs` beside the CLIs; in the standard itself they are imported from packages/core.
  // The fixture carries whichever this repository has, so the CLI under test starts either way.
  const core = join(repositoryRoot, 'packages/core/src');
  if (existsSync(core)) {
    mkdirSync(join(directory, 'packages/core'), { recursive: true });
    cpSync(core, join(directory, 'packages/core/src'), { recursive: true });
  }
  return directory;
}

/** A fixture that also carries the canonical workflows and a release policy the CLIs can read. */
function projectFixture(name) {
  const directory = fixture(name);
  mkdirSync(join(directory, '.github'), { recursive: true });
  cpSync(join(repositoryRoot, '.github/workflows'), join(directory, '.github/workflows'), { recursive: true });
  writeFileSync(join(directory, 'ops/release/global-policy.yaml'), policyText());
  return directory;
}

/** A fixture that also carries the project's own ops scripts at `ops/`, as a project has them. */
function projectOpsFixture(name) {
  const directory = fixture(name);
  cpSync(projectOpsDirectory(), join(directory, 'ops'), { recursive: true });
  return directory;
}

afterAll(() => {
  for (const directory of fixtures) rmSync(directory, { recursive: true, force: true });
});

/**
 * Every delivered CLI, with a fixture it must REFUSE. `expect` names the refusal the CLI is
 * supposed to produce, so a CLI that exits 1 for an unrelated reason (a crash, a missing file the
 * fixture should have had) does not count as a pass.
 */
const REFUSALS = [
  {
    cli: 'validate-workflows.mjs',
    why: 'a rendered workflow that no longer matches its canonical template',
    build: () => {
      const directory = projectFixture('validate');
      const workflow = join(directory, '.github/workflows/ci.yml');
      writeFileSync(workflow, `${readFileSync(workflow, 'utf8')}\n# tampered\n`);
      return { directory, args: ['.'] };
    },
    expect: /\.github\/workflows\/ci\.yml: differs from the canonical/,
  },
  {
    cli: 'check-project-scripts.mjs',
    why: 'a project that cannot run the scripts its own workflows call',
    build: () => {
      const directory = projectFixture('scripts');
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'tampered', scripts: {} }));
      return { directory, args: ['.'] };
    },
    expect: /missing required script/,
  },
  {
    // R8REL-02: the gate BODIES are the control. `pnpm run smoke:production` is only as strong as
    // what package.json makes that name run, and one word ("true") made the pre-promotion smoke
    // gate vacuous while every delivered control stayed green.
    cli: 'check-project-scripts.mjs',
    why: 'a package.json whose gate script no longer runs the pinned command',
    build: () => {
      const directory = projectFixture('pinned-bodies');
      const declaration = JSON.parse(readFileSync(join(directory, 'ops/release/package-scripts.json'), 'utf8'));
      const scripts = {};
      for (const [name, entry] of Object.entries(declaration.scripts ?? {})) scripts[name] = entry.command;
      const names = Object.keys(scripts);
      expect(names.length, 'the delivered declaration must pin at least one gate body').toBeGreaterThan(0);
      const target = names.includes('smoke:production') ? 'smoke:production' : names[0];
      scripts[target] = 'true';
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'tampered', scripts }));
      return { directory, args: ['.'] };
    },
    expect: /that ops\/release\/package-scripts\.json pins/,
  },
  {
    // R8REL-03: the delivered self-test is itself pinned by this gate, so a skipped, shortened or
    // deleted self-test fails workflow-validation instead of reporting a green required check.
    cli: 'check-project-scripts.mjs',
    why: 'a delivered self-test that is not the one the gate pinned',
    build: () => {
      const directory = projectFixture('pinned-self-test');
      const selfTest = join(directory, 'ops/release/release-controls.test.mjs');
      writeFileSync(selfTest, `${readFileSync(selfTest, 'utf8')}\n// tampered\n`);
      return { directory, args: ['.'] };
    },
    expect: /release-controls\.test\.mjs: is [0-9a-f]{12}, not the [0-9a-f]{12} this gate pins/,
  },
  {
    // D-025 / R9REL-01. The runner refuses to run ANY gate in a repository that carries a
    // package-manager or tool configuration file the reviewed declaration does not name. One
    // `.npmrc` - or, in the measured attack, one `pnpm-workspace.yaml` with `scriptShell` - used to
    // decide what every `pnpm run <gate>` executed while no delivered control read the file at all.
    cli: 'run-gate.mjs',
    why: 'an undeclared file that can change what every gate runs',
    build: () => {
      const directory = projectFixture('run-gate');
      writeFileSync(join(directory, '.npmrc'), 'script-shell=/usr/bin/true\n');
      return { directory, args: ['lint'] };
    },
    expect: /\.npmrc: can change what a gate runs and is declared by no entry of/,
  },
  {
    cli: 'secret-scan.mjs',
    why: 'a planted high-confidence token',
    build: () => {
      const directory = fixture('secret');
      writeFileSync(join(directory, 'planted.txt'), `${PLANTED_TOKEN}\n`);
      return { directory, args: ['planted.txt', '--root', '.', '--allowlist', 'ops/release/secret-scan.allowlist'] };
    },
    expect: /Potential secret in planted\.txt/,
  },
  {
    cli: 'required-gates.mjs',
    why: 'a repository with no release policy at all',
    build: () => {
      const directory = fixture('gates');
      rmSync(join(directory, 'ops/release/global-policy.yaml'), { force: true });
      return { directory, args: [] };
    },
    expect: /release policy not found/,
  },
  {
    cli: 'gate-results.mjs',
    why: 'gate evidence with no run to point at',
    build: () => ({ directory: projectFixture('evidence'), args: ['--required', '["lint"]'] }),
    expect: /GITHUB_RUN_ID/,
  },
  {
    cli: 'evaluate-gates.mjs',
    why: 'a required gate with no result',
    build: () => ({ directory: fixture('evaluate'), args: ['--required', '["lint"]', '--results', '{}'] }),
    expect: /Required gates failed: lint/,
  },
  {
    cli: 'decide-rollback.mjs',
    why: 'an unreadable health payload',
    build: () => ({ directory: fixture('decide'), args: ['{'] }),
    expect: /rollback_payload_unreadable/,
  },
  {
    cli: 'rollback-payload.mjs',
    why: 'no post-promotion health report at all',
    build: () => ({ directory: fixture('payload'), args: [] }),
    expect: /rollback_payload_without_health/,
  },
  {
    cli: 'health-outputs.mjs',
    why: 'a health report that publishes nothing',
    build: () => {
      const directory = fixture('health');
      writeFileSync(join(directory, 'health.json'), '{}');
      return { directory, args: ['health.json'] };
    },
    expect: /health output missing/,
  },
  {
    cli: 'record-candidate.mjs',
    why: 'a release identity with no policy revision',
    build: () => ({ directory: projectFixture('candidate'), args: ['--policy-revision', 'not-a-number'] }),
    expect: /policy_revision_missing/,
  },
  {
    cli: 'record-promotion.mjs',
    why: 'a candidate that carries no release identity',
    build: () => {
      const directory = projectFixture('promotion');
      writeFileSync(join(directory, 'candidate.json'), '{}');
      return { directory, args: ['--candidate', 'candidate.json', '--gate-results', '{}', '--out', 'promotion-record.json'] };
    },
    expect: /Promotion record refused/,
  },
  {
    cli: 'check-promotion.mjs',
    why: 'a promotion record that proves nothing about the production checkout',
    build: () => {
      const directory = projectFixture('check');
      writeFileSync(join(directory, 'record.json'), '{}');
      writeFileSync(join(directory, 'target.json'), '{}');
      return {
        directory,
        args: ['--record', 'record.json', '--target', 'target.json', '--current-run-id', '200', '--selected-run-id', '100', '--selected-head-sha', 'sha-staging'],
      };
    },
    expect: /Promotion check failed/,
  },
  {
    cli: 'select-staging-record.mjs',
    why: 'a listing with no promotable staging record',
    build: () => {
      const directory = fixture('select');
      writeFileSync(join(directory, 'listing.json'), JSON.stringify({ artifacts: [] }));
      return { directory, args: ['--listing', 'listing.json', '--tree-hash', 'tree-a', '--current-run-id', '200', '--repository-id', '42'] };
    },
    expect: /No promotable staging record/,
  },
  {
    cli: 'record-deployment.mjs',
    why: 'a candidate deployment that is the live production alias',
    build: () => {
      const directory = fixture('deployment');
      writeFileSync(join(directory, 'candidate-deployment.json'), JSON.stringify({ url: 'https://app.acme.example', id: 'dpl_abc123' }));
      return { directory, args: ['candidate-deployment.json', '--production-url', 'https://app.acme.example'] };
    },
    expect: /deployment_url_is_production_alias/,
  },
];

/**
 * R8REL-01. The project's own ops scripts, each with an invocation it must REFUSE. Two of them are
 * required gates in their own right (`migration:check` is `migrations`, `check:standard` is
 * `operational_readiness`); the other four are the pre-promotion smoke, the post-promotion health,
 * the promotion and the rollback. All six used to be switched off together by one line.
 */
const PROJECT_OPS_REFUSALS = [
  { script: 'smoke.mjs', why: 'a smoke run with no target', args: [], expect: /requires PRODUCTION_SMOKE_URL/ },
  { script: 'health.mjs', why: 'a health run with no target', args: [], expect: /requires PRODUCTION_HEALTH_URL/ },
  { script: 'promote.mjs', why: 'a promotion of a build nothing verified', args: [], expect: /nothing was promoted/ },
  { script: 'rollback.mjs', why: 'a rollback that does not preserve the database', args: [], expect: /never restores a database/ },
  {
    script: 'render-migration.mjs',
    why: 'a migration check against an environment that does not exist',
    args: ['--check', '--environment', 'qa', '--slug', 'demo_app', '--schema', 'app_demo_app_prod'],
    expect: /environment must be one of/,
  },
  { script: 'check-standard.mjs', why: 'a tree that carries none of the artefacts the standard requires', args: [], expect: /check:standard failed with/ },
];

/** A scrubbed environment: no CI variables leak in and change what a CLI decides. */
function cleanEnvironment(extra = {}) {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', ...extra };
}

// A misplaced copy must be visible rather than silently skipped: these are the only two places
// this file may sit, and only the first one runs the suite below.
it('this copy sits where the release controls are installed or delivered', () => {
  expect(['ops/release', 'ci/ops-release'], `unexpected location ${location}`).toContain(location);
});

// -------------------------------------------------------------------------------------------
// R8REL-03. ALWAYS ON, in both copies, whatever the suite below does. A green `ci-release-controls`
// used to be compatible with a self-test that had switched itself off; this case ties this file to
// the digest `ops/release/check-project-scripts.mjs` pins, and that gate - required in both
// canonical workflows, and needed by every other job - makes the same comparison from its side.
// Changing this file therefore means changing the pin in the same reviewed commit, and changing it
// without the pin fails `workflow-validation` instead of passing here.
// -------------------------------------------------------------------------------------------
it('this copy is the self-test the workflow-validation gate pinned (R8REL-03)', () => {
  const gatePath = join(controlsDirectory, 'check-project-scripts.mjs');
  expect(existsSync(gatePath), 'check-project-scripts.mjs must sit beside the self-test').toBe(true);
  const pinned = /SELF_TEST_SHA256 = '([0-9a-f]{64})'/.exec(readFileSync(gatePath, 'utf8'));
  expect(pinned, 'check-project-scripts.mjs must pin the delivered self-test by digest').toBeTruthy();
  const digest = createHash('sha256').update(readFileSync(selfPath)).digest('hex');
  expect(digest, 'this self-test is not the one the workflow-validation gate pins; update SELF_TEST_SHA256 in the same reviewed change').toBe(pinned[1]);
});

describe.skipIf(!installed)('the delivered release controls refuse what they exist to refuse', () => {
  // -----------------------------------------------------------------------------------------
  // R7REL-02. The canary. Neuter any one CLI's entry-point check - or its refusal - and its case
  // here goes red, in this repository's own CI, before a release can use it.
  // -----------------------------------------------------------------------------------------
  for (const refusal of REFUSALS) {
    it(`${refusal.cli} refuses ${refusal.why}`, () => {
      const { directory, args } = refusal.build();
      const cli = join(directory, 'ops/release', refusal.cli);
      expect(existsSync(cli), `${refusal.cli} is delivered`).toBe(true);
      const run = spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8', env: cleanEnvironment() });
      const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
      expect(run.status, `${refusal.cli} must exit 1 on ${refusal.why}; it exited ${run.status} with ${JSON.stringify(output.slice(0, 400))}`).toBe(1);
      expect(output, `${refusal.cli} must say why it refused`).toMatch(refusal.expect);
      expect(output.trim(), `${refusal.cli} must not refuse silently`).not.toBe('');
    });
  }

  // -----------------------------------------------------------------------------------------
  // R8REL-01. The same canary for the project's own ops scripts: `ops/smoke.mjs` reporting success
  // with an empty log is `promote-production`'s licence to promote a deployment nothing checked.
  // -----------------------------------------------------------------------------------------
  for (const refusal of PROJECT_OPS_REFUSALS) {
    it(`ops/${refusal.script} refuses ${refusal.why}`, () => {
      const directory = projectOpsFixture(refusal.script.replace('.mjs', ''));
      const script = join(directory, 'ops', refusal.script);
      expect(existsSync(script), `ops/${refusal.script} is delivered`).toBe(true);
      const run = spawnSync(process.execPath, [script, ...refusal.args], { cwd: directory, encoding: 'utf8', env: cleanEnvironment() });
      const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
      expect(run.status, `ops/${refusal.script} must exit 1 on ${refusal.why}; it exited ${run.status} with ${JSON.stringify(output.slice(0, 400))}`).toBe(1);
      expect(output, `ops/${refusal.script} must say why it refused`).toMatch(refusal.expect);
      expect(output.trim(), `ops/${refusal.script} must not refuse silently`).not.toBe('');
    });
  }

  it('every delivered CLI decides for itself whether it was invoked as a script', () => {
    // DERIVED, not listed: every delivered .mjs that carries an entry-point check is a CLI, and
    // every CLI must have a refusal case above. A new one cannot ship without one.
    const covered = new Set(REFUSALS.map((refusal) => refusal.cli));
    const clis = readdirSync(controlsDirectory)
      .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
      .filter((name) => readFileSync(join(controlsDirectory, name), 'utf8').includes('function invokedAsScript(moduleUrl)'));
    expect(clis.length, 'the delivered controls must contain CLIs').toBeGreaterThan(0);
    for (const name of clis) {
      const source = readFileSync(join(controlsDirectory, name), 'utf8');
      // The check is INLINE in every CLI. A shared import is the defect this file exists for: one
      // return value that switches every release control off at once.
      expect(source, `${name} must compare REAL paths`).toContain('real(fileURLToPath(moduleUrl)) === real(invoked)');
      expect(source, `${name} must not import a shared entry-point helper`).not.toContain("from './entrypoint.mjs'");
      expect(covered.has(name), `${name} is a delivered CLI with no refusal case in this file`).toBe(true);
    }
  });

  it('every project ops script the gates run decides for itself whether it was invoked (R8REL-01)', () => {
    const directory = projectOpsDirectory();
    const covered = new Set(PROJECT_OPS_REFUSALS.map((refusal) => refusal.script));
    // DERIVED, not listed: every `node ops/<file>.mjs` the delivered declaration pins as the body
    // of a gate script is a script a gate runs, so a new one cannot ship without a refusal case.
    // A project's own unrelated ops scripts are not gates and are left alone.
    const declaration = JSON.parse(readFileSync(join(controlsDirectory, 'package-scripts.json'), 'utf8'));
    const fromDeclaration = new Set();
    for (const entry of Object.values(declaration.scripts ?? {})) {
      const match = /\bnode\s+ops\/([A-Za-z0-9._-]+\.mjs)/.exec(String(entry?.command ?? ''));
      if (match) fromDeclaration.add(match[1]);
    }
    const scripts = [...new Set([...covered, ...fromDeclaration])].sort();
    expect(scripts.length, 'a project must carry the ops scripts its gates run').toBeGreaterThan(0);
    for (const name of scripts) {
      expect(existsSync(join(directory, name)), `ops/${name} is delivered`).toBe(true);
      const source = readFileSync(join(directory, name), 'utf8');
      expect(source, `ops/${name} must carry its own entry-point check`).toContain('function invokedAsScript(moduleUrl)');
      expect(source, `ops/${name} must compare REAL paths`).toContain('real(fileURLToPath(moduleUrl)) === real(invoked)');
      // The shared helper is gone. It is the defect this rule exists for: one return value that
      // silenced the smoke, the health, the promotion, the rollback and two required gates.
      expect(source, `ops/${name} must not import a shared entry-point helper`).not.toMatch(/from\s+["'][^"']*entrypoint\.mjs["']/);
      expect(source, `ops/${name} must not call a shared entry-point helper`).not.toMatch(/\bisEntrypoint\s*\(/);
      expect(existsSync(join(directory, 'entrypoint.mjs')), 'the shared ops entry-point helper must not come back').toBe(false);
      // build-production.mjs is exercised by the starter lane's own suite, not here; every other
      // ops script the canonical workflows run has a refusal case above.
      if (name !== 'build-production.mjs') {
        expect(covered.has(name), `ops/${name} is a project ops script with no refusal case in this file`).toBe(true);
      }
    }
  });

  // -----------------------------------------------------------------------------------------
  // R7REL-02, second half, repaired by R8REL-05: every delivered control is under code-owner review
  // in the plan delivered beside it. The previous derivation walked exactly the two directories the
  // plan already listed, so `escaped` was empty by construction and adding `ops/newcontrol.mjs`
  // left the suite green. It now walks the REPOSITORY and classifies by what a file IS.
  // -----------------------------------------------------------------------------------------
  it('the delivered branch-protection plan puts every delivered control under code-owner review', () => {
    const plan = JSON.parse(readFileSync(join(controlsDirectory, 'branch-protection.plan.json'), 'utf8'));
    const paths = plan.code_owner_review?.paths ?? [];
    expect(Array.isArray(paths) && paths.length > 0, 'the plan must list code-owner paths').toBe(true);
    const covered = (file) => paths.some((entry) => file === entry || file.startsWith(entry.endsWith('/') ? entry : `${entry}/`));

    // What counts as a control, independent of what the plan happens to list: anything under
    // .github/ (the workflows and the automation config), anything under ops/ (every script a gate
    // runs), any executable module, and the configuration files the required gates read - the gate
    // bodies (package.json), what typecheck checks, what the install resolves, and the manifest
    // that binds this project to a reviewed standard.
    //
    // R9REL-01/R9REL-02, and the residual R8REL-05 the ninth review measured: the previous
    // predicate was a file-EXTENSION test, so `pnpm-workspace.yaml`, `.npmrc` and `vitest.config.js`
    // were not controls - and those three decide what a gate runs. Adding all three to a generated
    // project at once left this case at 27 passed. It is now "anything a gate step reads", by name
    // as well as by extension, so a configuration file that can redirect a gate has to be under
    // code-owner review wherever it appears.
    const GATE_CONFIGURATION = new Set(['package.json', 'tsconfig.json', 'pnpm-lock.yaml', '.project-launch-starter.json']);
    const TOOL_CONFIGURATION = [
      /(^|\/)[A-Za-z0-9._-]+\.config\.[cm]?[jt]s$/,
      /(^|\/)vitest\.workspace\.[cm]?[jt]s$/,
      /(^|\/)pnpm-workspace\.ya?ml$/,
      /(^|\/)\.npmrc$/,
      /(^|\/)\.pnpmfile\.[cm]?js$/,
      /(^|\/)tsconfig[A-Za-z0-9._-]*\.json$/,
      /(^|\/)\.env(\.[A-Za-z0-9._-]+)?$/,
      /(^|\/)\.nvmrc$/,
      /(^|\/)\.node-version$/,
    ];
    const isControl = (file) => file.startsWith('.github/')
      || file.startsWith('ops/')
      || file.endsWith('.mjs')
      || GATE_CONFIGURATION.has(file)
      || TOOL_CONFIGURATION.some((pattern) => pattern.test(file));
    const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', 'build', 'out', '.turbo', '.vercel']);

    const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      if (SKIP.has(entry.name)) return [];
      const full = join(directory, entry.name);
      if (!statSync(full).isDirectory()) return [relative(repositoryRoot, full).split('\\').join('/')];
      return walk(full);
    });

    // In a delivered project the whole tree is walked, which is what makes a NEW control anywhere
    // visible. The standard's own copy of this file sits in a monorepo that is not a delivered
    // project - its far larger inventory is derived in ops/release/release.test.mjs instead - so
    // there the walk stays on what this project layout would hold.
    const deliveredProject = existsSync(join(repositoryRoot, '.project-launch-starter.json'));
    const files = deliveredProject
      ? walk(repositoryRoot)
      : [...walk(controlsDirectory), ...walk(join(repositoryRoot, '.github/workflows')), ...walk(projectOpsDirectory())];

    const controls = files.filter((file) => isControl(file));
    expect(controls.length, 'the walk must find the delivered controls').toBeGreaterThan(0);
    const escaped = controls.filter((file) => !covered(file));
    expect(escaped, `these delivered control files are under no code-owner path: ${escaped.join(', ')}`).toEqual([]);

    // The exact files the previous predicate did not classify as controls. The ninth review added
    // all three to a generated project at once and this case stayed green at 27 passed, while the
    // three of them decided which shell ran every gate body and whether any test ran at all.
    for (const missed of ['pnpm-workspace.yaml', '.npmrc', '.pnpmfile.cjs', 'vitest.config.js', 'vitest.workspace.ts', 'vite.config.mts', '.env.production', '.nvmrc']) {
      expect(isControl(missed), `${missed} decides what a gate runs and must be a control (R9REL-01, R9REL-02)`).toBe(true);
    }
    // ... and the predicate still has to be able to FAIL, which is what R8REL-05 was about.
    expect(isControl('src/app/page.tsx'), 'an ordinary source file is not a gate input').toBe(false);
    expect(isControl('scripts/deploy.mjs'), 'an executable module anywhere is a control').toBe(true);
  });

  // -----------------------------------------------------------------------------------------
  // D-025 / R9REL-01, R9REL-02, R9REL-03. The delivered workflows run gates through ONE runner.
  // This case reads the workflows this project actually has and refuses the three spellings the
  // ninth review broke, so a project that edited its own workflows back to `pnpm run <gate>` -
  // or that re-introduced the `--` separator - turns ci-release-controls red.
  // -----------------------------------------------------------------------------------------
  it('every gate step of this project\'s canonical workflows is the delivered runner (D-025)', () => {
    const directory = join(repositoryRoot, '.github/workflows');
    const names = readdirSync(directory).filter((name) => /\.ya?ml$/i.test(name)).sort();
    expect(names.length, 'a managed project carries canonical workflows').toBeGreaterThan(0);
    expect(existsSync(join(controlsDirectory, 'run-gate.mjs')), 'the delivered gate runner must exist').toBe(true);
    expect(existsSync(join(controlsDirectory, 'gates.json')), 'the delivered gate declaration must exist').toBe(true);
    let runnerSteps = 0;
    for (const name of names) {
      // Whole-line comments are removed: a workflow has to be able to explain the spellings it no
      // longer uses. An inline `#` is NOT stripped, so hiding one behind it still fails.
      const text = readFileSync(join(directory, name), 'utf8').split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
      expect(text, `${name} must not run a gate through the package-manager script layer (R9REL-01)`).not.toMatch(/\bpnpm\s+run\b/);
      expect(text, `${name} must not run a test gate without a pinned configuration (R9REL-02)`).not.toMatch(/\bpnpm\s+(?:exec\s+)?vitest\b/);
      expect(text, `${name} must not forward a bare "--" separator to a script (R9REL-03)`).not.toMatch(/(^|\s)--(\s|$)/m);
      runnerSteps += (text.match(/node ops\/release\/run-gate\.mjs /g) ?? []).length;
    }
    expect(runnerSteps, 'the canonical workflows must run their gates through ops/release/run-gate.mjs').toBeGreaterThan(5);
  });
});
