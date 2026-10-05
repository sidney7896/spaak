// THE ONE GATE RUNNER (D-025, R9REL-01/02/03/05).
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/run-gate.mjs and delivered into
// every generated project as `ops/release/run-gate.mjs`; `ops/release/release.test.mjs` asserts the
// two copies never diverge.
//
// WHY IT EXISTS. Until this runner, every gate of both canonical workflows was `pnpm run <name>`,
// `pnpm exec vitest run <dir>` or `pnpm run <name> -- <args>`, and the ninth review measured three
// separate consequences of that one decision, each in a real generated project:
//
//   R9REL-01  `pnpm-workspace.yaml` with three words (`scriptShell: /usr/bin/true`) turned EVERY
//             `pnpm run <gate>` into exit 0 with `package.json` byte-identical. The gate bodies were
//             pinned; the shell that runs them was not, and no control read that file at all.
//   R9REL-02  `vitest.config.js` with `passWithNoTests: true` made `ci-release-controls` green with
//             zero tests executed - the self-test that exists to catch a neutered control was the
//             very file the config excluded - and made six required gates vacuous.
//   R9REL-03  pnpm 11.9.0 forwards the `--` separator, so seven steps of `release.yml` handed the
//             literal token `--` to an ops script that refuses unknown arguments: the required
//             `migrations` gate was red by construction and the whole production lane failed on its
//             first argument. No test exercised the `pnpm run <name> -- <args>` form.
//   R9REL-05  `pnpm run` prepends `node_modules/.bin` to PATH, so a `node` entry there made
//             `node ops/smoke.mjs` exit 0 with the pinned body untouched.
//
// All four are the same defect seen four times: the WORKFLOW pinned a string, and something else -
// a package-manager setting, a tool config, an argument convention, a PATH entry - decided what that
// string did. D-025 removes the layer instead of pinning one more file inside it.
//
// WHAT THIS RUNNER DOES, in this order, for EVERY gate including the ones with no body:
//
//   1. It loads `ops/release/gates.json`, the reviewed declaration of what each gate runs.
//   2. It refuses when any file that can alter tool behaviour is UNDECLARED or is not in the state
//      the declaration pins (`controlErrors`). The pattern list is a constant of this source, so a
//      repository cannot shrink it by editing data; the declaration may only say what is allowed.
//   3. It builds an argv ARRAY - never a command line, never a shell. `node` is `process.execPath`
//      (the interpreter already running, not a PATH lookup, not `node_modules/.bin/node`), and every
//      tool is resolved from the package the lockfile installed, by REAL path, and refused if that
//      path leaves this repository's `node_modules`.
//   4. Every vitest gate is given `--config <pinned path>` and its collected test count is compared
//      with the minimum the declaration pins, from the run's own JSON report. `passWithNoTests` can
//      no longer make a gate green with nothing executed, because the gate now has to PROVE that
//      tests ran rather than prove a file exists.
//
// What it deliberately does NOT do: install dependencies. `pnpm install --frozen-lockfile` stays a
// workflow step of its own, which is why `run-gate.mjs controls` runs in the workflow-validation
// job - a job that only checks the repository out, that every other job needs, and that therefore
// refuses an undeclared `pnpm-workspace.yaml` BEFORE any install anywhere has read it.
//
// It imports node: builtins and nothing else (R3-04): the jobs that run it only check the
// repository out, or run it before the install has finished.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GATE_DECLARATION = 'ops/release/gates.json';

/**
 * THE CLOSED LIST (D-025). Every file that can change what a tool does when the gate runs it, as a
 * constant of this program rather than data in the repository being gated. A file at the repository
 * ROOT whose name matches one of these is a CONTROL: it must be named by `gates.json`, which then
 * says whether it is pinned by digest (a delivered file) or owned by the project (a code-owner path
 * whose content the standard cannot know). A match that is declared nowhere is a refusal.
 *
 * Only the root is scanned, and that bound is deliberate rather than lazy: every gate is given an
 * explicit `--config` path and runs with the repository root as its working directory, so a
 * `vitest.config.ts` three directories down cannot reach it. What a deeper file CAN reach is the
 * package manager - `pnpm` reads `pnpm-workspace.yaml`, `.npmrc` and `.pnpmfile.cjs` from the
 * workspace root - and that is exactly what this list covers at the only place it is read.
 */
export const BEHAVIOUR_FILE_PATTERNS = [
  /^pnpm-workspace\.ya?ml$/i,
  /^\.npmrc$/i,
  /^\.pnpmfile\.[cm]?js$/i,
  /^vitest\.config\.(?:json|[cm]?[jt]s)$/i,
  /^vitest\.(?:workspace|projects)\.(?:json|[cm]?[jt]s)$/i,
  /^vite\.config\.[cm]?[jt]s$/i,
  /^tsconfig[A-Za-z0-9._-]*\.json$/i,
  /^\.env(\.[A-Za-z0-9._-]+)?$/i,
  /^package\.json$/i,
  /^eslint\.config\.[cm]?[jt]s$/i,
  /^next\.config\.[cm]?[jt]s$/i,
  /^\.nvmrc$/i,
  /^\.node-version$/i,
];

/** Anything that switches vitest's "a run with no tests is a pass" back on, in any spelling. */
const PASS_WITH_NO_TESTS = /pass[-_]?with[-_]?no[-_]?tests/i;

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

/** Is `candidate` (a real path) the boundary itself or inside it? */
function within(boundary, candidate) {
  return candidate === boundary || candidate.startsWith(`${boundary}${sep}`);
}

export function loadGateDeclaration(rootDir = process.cwd()) {
  const path = join(resolve(rootDir), GATE_DECLARATION);
  if (!existsSync(path)) {
    return { declaration: null, errors: [`${GATE_DECLARATION}: the gate declaration is missing, so nothing says what a gate runs; every gate of both canonical workflows is this file plus this runner`] };
  }
  try {
    const declaration = JSON.parse(readFileSync(path, 'utf8'));
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
      return { declaration: null, errors: [`${GATE_DECLARATION}: is not a JSON object`] };
    }
    return { declaration, errors: [] };
  } catch (error) {
    return { declaration: null, errors: [`${GATE_DECLARATION}: is not valid JSON (${error instanceof Error ? error.message : 'parse error'})`] };
  }
}

/** Every literal token any declared gate would hand to a program. */
function declaredLiterals(declaration) {
  const tokens = [];
  for (const gate of Object.values(declaration?.gates ?? {})) {
    for (const argument of gate?.argv ?? []) if (typeof argument === 'string') tokens.push(argument);
  }
  return tokens;
}

/**
 * THE CONTROL CHECK. Run before EVERY gate body, and on its own as the `controls` gate in the
 * workflow-validation job of both canonical workflows - the job that needs no install and that
 * every other job depends on, so an undeclared package-manager configuration is refused before a
 * single `pnpm install` has read it.
 */
export function controlErrors(rootDir = process.cwd(), declaration = null) {
  const root = resolve(rootDir);
  const controls = declaration && typeof declaration.controls === 'object' && !Array.isArray(declaration.controls)
    ? declaration.controls
    : null;
  if (!controls) {
    return [`${GATE_DECLARATION}: declares no "controls" mapping, so nothing pins the files that decide what a gate actually does`];
  }
  const errors = [];

  // (a) NOTHING UNDECLARED. A file at the root that can alter tool behaviour and that the reviewed
  // declaration does not name is refused - it is the R9REL-01 and R9REL-02 shape exactly.
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    return [`${root}: cannot be read (${error instanceof Error ? error.message : 'unreadable'}), so the gate inputs cannot be checked`];
  }
  for (const entry of entries) {
    const name = entry.name;
    if (!BEHAVIOUR_FILE_PATTERNS.some((pattern) => pattern.test(name))) continue;
    if (!Object.prototype.hasOwnProperty.call(controls, name)) {
      errors.push(`${name}: can change what a gate runs and is declared by no entry of ${GATE_DECLARATION}; a package-manager or tool configuration file is a CONTROL (D-025), so it is refused rather than obeyed`);
      continue;
    }
    if (entry.isDirectory()) errors.push(`${name}: is a directory, but ${GATE_DECLARATION} declares it as a gate input`);
  }

  // (b) EVERY DECLARED CONTROL IN THE STATE IT IS PINNED IN.
  for (const [relative, entry] of Object.entries(controls)) {
    const pin = entry?.pin;
    const absolute = join(root, relative);
    const present = existsSync(absolute);
    if (pin === 'sha256') {
      if (!present) {
        errors.push(`${relative}: ${GATE_DECLARATION} pins this delivered gate input by digest, but it is missing`);
        continue;
      }
      let digest;
      try {
        digest = sha256(readFileSync(absolute));
      } catch (error) {
        errors.push(`${relative}: cannot be read (${error instanceof Error ? error.message : 'unreadable'}), so the gate input it pins cannot be verified`);
        continue;
      }
      if (digest !== entry.sha256) {
        errors.push(`${relative}: is ${digest.slice(0, 12)}, not the ${String(entry.sha256).slice(0, 12)} ${GATE_DECLARATION} pins; this file decides what a gate runs, so editing it is a change to the standard, not to this project`);
      }
    } else if (pin === 'project') {
      if (!present && entry.optional !== true) {
        errors.push(`${relative}: ${GATE_DECLARATION} declares it as an input every gate reads, but it is missing`);
      }
    } else if (pin === 'absent') {
      if (present) errors.push(`${relative}: ${GATE_DECLARATION} declares that this repository carries no such file, but it exists`);
    } else {
      errors.push(`${GATE_DECLARATION}: control ${relative} declares the unknown pin ${JSON.stringify(pin ?? null)}; a control is pinned by "sha256", owned by the project ("project") or forbidden ("absent")`);
    }
  }

  // (c) package.json's `pnpm` field is executable configuration in a data file: `onlyBuiltDependencies`
  // re-enables dependency install scripts, `overrides` and `packageExtensions` change what the
  // install resolves. The gate bodies in that file are pinned by check-project-scripts.mjs; this is
  // the half that decides what runs around them.
  const packagePath = join(root, 'package.json');
  if (existsSync(packagePath)) {
    try {
      const parsed = JSON.parse(readFileSync(packagePath, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.pnpm !== undefined) {
        errors.push('package.json: carries a "pnpm" field; onlyBuiltDependencies, overrides and packageExtensions change what an install executes and what a gate resolves, so that configuration belongs in a reviewed change to the standard and not in a project\'s own package.json');
      }
    } catch {
      errors.push('package.json: is not valid JSON, so the gate inputs cannot be checked');
    }
  }

  // (d) THE PINNED VITEST CONFIGURATION IS THE ONLY ONE ANY GATE USES, and it must forbid the
  // setting that made a green gate compatible with zero executed tests.
  const configPath = declaration?.vitestConfig;
  if (Object.values(declaration?.gates ?? {}).some((gate) => gate?.kind === 'vitest')) {
    if (!isText(configPath)) {
      errors.push(`${GATE_DECLARATION}: declares a vitest gate but no "vitestConfig", so a test gate would fall back to whatever configuration the repository happens to carry (R9REL-02)`);
    } else if (!Object.prototype.hasOwnProperty.call(controls, configPath)) {
      errors.push(`${GATE_DECLARATION}: the vitest configuration ${configPath} is not one of the declared controls, so nothing pins it`);
    } else if (existsSync(join(root, configPath))) {
      // Whole-line comments are removed first: the pinned configuration has to be allowed to
      // EXPLAIN the setting it forbids. Its bytes are pinned above, so the explanation is reviewed.
      const text = readFileSync(join(root, configPath), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
        .join('\n');
      if (!/passWithNoTests\s*:\s*false/.test(text)) {
        errors.push(`${configPath}: does not set passWithNoTests to false; a test gate must fail when it collects nothing`);
      }
      if (/passWithNoTests\s*:\s*true/.test(text)) {
        errors.push(`${configPath}: sets passWithNoTests to true, which is the setting that made a required gate green with zero tests executed (R9REL-02)`);
      }
    }
  }

  // (e) ... and no gate may switch it back on from the command line either.
  for (const [name, gate] of Object.entries(declaration?.gates ?? {})) {
    for (const argument of gate?.argv ?? []) {
      if (typeof argument === 'string' && PASS_WITH_NO_TESTS.test(argument)) {
        errors.push(`${GATE_DECLARATION}: gate ${name} passes ${JSON.stringify(argument)}; a gate may not tell its test runner that collecting nothing is a pass`);
      }
    }
  }
  for (const token of declaredLiterals(declaration)) {
    if (token === '--') {
      errors.push(`${GATE_DECLARATION}: a gate passes a bare "--" separator; the runner hands an argv ARRAY to the program, so the separator pnpm used to forward is not needed and every delivered ops script refuses it (R9REL-03)`);
    }
  }
  return errors;
}

/**
 * R9REL-05. Resolve a tool from the installation the lockfile describes, by REAL path.
 *
 * The entry point comes from the installed package's own `bin` field, never from PATH and never by
 * executing `node_modules/.bin/<tool>`: that shim is a shell script which re-resolves `node`, and a
 * `node` entry beside it is what made a pinned body exit 0 with the body untouched. The shim is
 * still CHECKED - it must point at the same real file - so planting one is visible rather than
 * merely ineffective.
 */
export function resolveToolEntry(rootDir, toolName, declaration, environment = process.env) {
  const root = resolve(rootDir);
  const spec = declaration?.tools?.[toolName];
  if (!spec || !isText(spec.package) || !isText(spec.bin)) {
    return { entry: null, errors: [`${GATE_DECLARATION}: declares no installed package for the tool ${toolName}, so the gate cannot resolve it`] };
  }
  const modules = join(root, 'node_modules');
  let modulesReal;
  try {
    modulesReal = realpathSync(modules);
  } catch {
    return { entry: null, errors: [`node_modules: is missing, so ${toolName} cannot be resolved from the installation this repository's lockfile describes; the workflow runs "pnpm install --frozen-lockfile" before every gate that needs a tool`] };
  }
  let boundary;
  try {
    boundary = realpathSync(root);
  } catch {
    boundary = root;
  }
  if (lstatSync(modules).isSymbolicLink()) {
    if (environment?.LAUNCH_GATE_LINKED_NODE_MODULES === modulesReal) {
      boundary = modulesReal;
    } else {
      return { entry: null, errors: [`node_modules: is a symbolic link to ${modulesReal}; a gate runs tools only from an installation inside this repository (R10REL-02); a test harness may accept one exact link target by setting LAUNCH_GATE_LINKED_NODE_MODULES to it, and the canonical workflows never do`] };
    }
  }
  const manifestPath = join(modules, spec.package, 'package.json');
  if (!existsSync(manifestPath)) {
    return { entry: null, errors: [`node_modules/${spec.package}: the installed dependency tree does not contain ${toolName}`] };
  }
  let manifest;
  let manifestReal;
  try {
    manifestReal = realpathSync(manifestPath);
    manifest = JSON.parse(readFileSync(manifestReal, 'utf8'));
  } catch (error) {
    return { entry: null, errors: [`node_modules/${spec.package}/package.json: cannot be read (${error instanceof Error ? error.message : 'unreadable'})`] };
  }
  const bin = manifest?.bin;
  const declared = typeof bin === 'string' ? bin : (bin && typeof bin === 'object' ? bin[spec.bin] : undefined);
  if (!isText(declared)) {
    return { entry: null, errors: [`node_modules/${spec.package}: declares no ${spec.bin} binary, so ${toolName} has no entry point to run`] };
  }
  let entry;
  try {
    entry = realpathSync(join(dirname(manifestReal), declared));
  } catch {
    return { entry: null, errors: [`node_modules/${spec.package}: the ${spec.bin} entry point (${declared}) does not exist`] };
  }
  if (!within(boundary, entry)) {
    return { entry: null, errors: [`${toolName}: resolves to ${entry}, which is outside this repository's node_modules; a gate never runs a program from outside the installation its own lockfile describes`] };
  }

  // The shim cross-check. It cannot redirect this runner - the entry above came from the package -
  // but a shim that runs something else is a tampered installation, and a gate says so.
  const errors = [];
  const shim = join(modules, '.bin', spec.bin);
  if (!existsSync(shim)) {
    errors.push(`node_modules/.bin/${spec.bin}: the installed dependency tree exposes no ${spec.bin} binary, so the lockfile did not install the tool this gate runs`);
  } else {
    let target = null;
    try {
      if (lstatSync(shim).isSymbolicLink()) {
        target = realpathSync(shim);
      } else {
        const marked = /#\s*cmd-shim-target=(\S.*?)\s*$/m.exec(readFileSync(shim, 'utf8'));
        if (marked) {
          try {
            target = realpathSync(marked[1]);
          } catch {
            target = marked[1];
          }
        }
      }
    } catch (error) {
      errors.push(`node_modules/.bin/${spec.bin}: cannot be inspected (${error instanceof Error ? error.message : 'unreadable'})`);
    }
    if (target === null && errors.length === 0) {
      errors.push(`node_modules/.bin/${spec.bin}: is neither a symlink nor a shim that names its target, so this gate cannot establish that the installed ${spec.bin} is the ${entry} it is about to run`);
    } else if (target !== null && target !== entry) {
      errors.push(`node_modules/.bin/${spec.bin}: runs ${target}, not the ${entry} the installed ${spec.package} declares; a shim in node_modules/.bin may not redirect a gate (R9REL-05)`);
    }
  }
  return { entry, errors };
}

/**
 * A package manager is the one program a gate cannot resolve from the repository - it is what
 * installs the repository. It is taken from PATH, by real path, and REFUSED when that real path
 * lies inside the repository being gated: a checked-in `pnpm` is a program the diff under test
 * supplied.
 */
export function resolveManagerBinary(rootDir, name, environment = process.env) {
  const root = resolve(rootDir);
  let rootReal;
  try {
    rootReal = realpathSync(root);
  } catch {
    rootReal = root;
  }
  const search = String(environment?.PATH ?? '').split(delimiter).filter((directory) => directory !== '');
  for (const directory of search) {
    const candidate = join(directory, name);
    let info;
    try {
      info = statSync(candidate);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    let real;
    try {
      real = realpathSync(candidate);
    } catch {
      continue;
    }
    if (within(rootReal, real)) {
      return { binary: null, errors: [`${name}: the first ${name} on PATH is ${real}, inside the repository being gated; a gate never runs a package manager the repository under test supplies`] };
    }
    return { binary: real, errors: [] };
  }
  return { binary: null, errors: [`${name}: is not on PATH, so the ${name} gate cannot run; the canonical workflows install it with pnpm/action-setup before this step`] };
}

function resolveArguments(argv, environment, gateName, errors) {
  const resolved = [];
  for (const argument of argv ?? []) {
    if (typeof argument === 'string') {
      resolved.push(argument);
      continue;
    }
    if (argument && typeof argument === 'object' && isText(argument.env)) {
      const value = environment?.[argument.env];
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push(`${gateName}: needs the ${argument.env} environment value the canonical workflow supplies, and it is empty or unset; the gate refuses rather than running against an unnamed target`);
        continue;
      }
      resolved.push(value);
      continue;
    }
    errors.push(`${gateName}: an argument in ${GATE_DECLARATION} is neither a literal string nor an {"env": "NAME"} reference`);
  }
  return resolved;
}

/**
 * Build the exact argv a gate runs. Pure and exported: `ops/release/release.test.mjs` asserts the
 * command form of EVERY step of both canonical workflows against this, in a real generated project,
 * so a broken invocation cannot ship again (R9REL-03).
 */
export function gateInvocation(rootDir, gateName, declaration, { environment = process.env, reportPath = null } = {}) {
  const root = resolve(rootDir);
  const gate = declaration?.gates?.[gateName];
  if (!gate) {
    const declared = Object.keys(declaration?.gates ?? {}).sort().join(', ');
    return { gate: null, command: null, args: [], errors: [`${gateName}: is not a gate ${GATE_DECLARATION} declares (declared: ${declared || 'none'})`] };
  }
  const errors = [];
  if (gate.kind === 'controls') return { gate, command: null, args: [], errors };

  if (gate.kind === 'vitest') {
    if (!isText(declaration?.vitestConfig)) {
      return { gate, command: null, args: [], errors: [`${GATE_DECLARATION}: gate ${gateName} runs vitest but no pinned "vitestConfig" is declared`] };
    }
    const tool = resolveToolEntry(root, 'vitest', declaration, environment);
    errors.push(...tool.errors);
    const paths = Array.isArray(gate.paths) ? gate.paths : [];
    const args = [tool.entry ?? '', 'run', ...paths, '--config', declaration.vitestConfig, '--reporter=default', '--reporter=json'];
    if (reportPath) args.push(`--outputFile.json=${reportPath}`);
    return { gate, command: process.execPath, args, errors };
  }

  if (gate.kind === 'tool') {
    const tool = resolveToolEntry(root, gate.tool, declaration, environment);
    errors.push(...tool.errors);
    const args = [tool.entry ?? '', ...resolveArguments(gate.argv, environment, gateName, errors)];
    return { gate, command: process.execPath, args, errors };
  }

  if (gate.kind === 'ops' || gate.kind === 'control') {
    if (!isText(gate.script)) {
      return { gate, command: null, args: [], errors: [`${GATE_DECLARATION}: gate ${gateName} names no script to run`] };
    }
    if (!existsSync(join(root, gate.script))) {
      errors.push(`${gate.script}: the ${gateName} gate runs this script and it does not exist`);
    }
    const args = [join(root, gate.script), ...resolveArguments(gate.argv, environment, gateName, errors)];
    return { gate, command: process.execPath, args, errors };
  }

  if (gate.kind === 'manager') {
    const manager = resolveManagerBinary(root, gate.manager ?? 'pnpm', environment);
    errors.push(...manager.errors);
    const args = resolveArguments(gate.argv, environment, gateName, errors);
    return { gate, command: manager.binary, args, errors };
  }

  return { gate, command: null, args: [], errors: [`${GATE_DECLARATION}: gate ${gateName} declares the unknown kind ${JSON.stringify(gate.kind ?? null)}`] };
}

/**
 * The child's environment. The job's own values are passed through - a production gate needs its
 * target URL and its provider credentials - but the two variables that let a caller load arbitrary
 * code into every Node process are removed, because a gate runs the repository's programs and not a
 * preload somebody put in the environment around it.
 */
export const LOADER_VARIABLES = ['NODE_OPTIONS', 'NODE_PATH', 'NODE_REPL_EXTERNAL_MODULE'];
const STRIPPED_NAMES = [...LOADER_VARIABLES, 'NODE_COMPILE_CACHE', 'NODE_V8_COVERAGE'];
const STRIPPED_PREFIXES = ['VITEST_', 'TS_NODE_', 'NPM_CONFIG_'];

export function gateEnvironment(environment = process.env) {
  // R10REL-04: strip every loader and config variable.
  const passed = {};
  for (const [name, value] of Object.entries(environment ?? {})) {
    const upper = name.toUpperCase();
    if (STRIPPED_NAMES.includes(upper) || STRIPPED_PREFIXES.some((prefix) => upper.startsWith(prefix))) continue;
    passed[name] = value;
  }
  return passed;
}

/**
 * R9REL-02. The proof a test gate owes: not "the file exists" and not "vitest exited 0", but a
 * count of tests that were actually collected and passed, compared with the minimum the reviewed
 * declaration pins for this gate.
 */
export function testCountErrors(gateName, report, minimum) {
  const floor = Number.isInteger(minimum) && minimum > 0 ? minimum : 1;
  if (!report || typeof report !== 'object') {
    return [`${gateName}: vitest wrote no machine-readable report, so nothing proves any test ran; a test gate must report the tests it executed`];
  }
  const total = Number(report.numTotalTests);
  const passed = Number(report.numPassedTests);
  const failed = Number(report.numFailedTests);
  const errors = [];
  if (!Number.isFinite(total) || !Number.isFinite(passed)) {
    return [`${gateName}: the vitest report carries no test counts, so nothing proves any test ran`];
  }
  if (Number.isFinite(failed) && failed > 0) {
    errors.push(`${gateName}: ${failed} test(s) failed`);
  }
  if (total < floor) {
    errors.push(`${gateName}: collected ${total} tests, fewer than the ${floor} ${GATE_DECLARATION} pins for this gate; a run that collects nothing is not a passed gate (R9REL-02)`);
  }
  if (passed < floor) {
    errors.push(`${gateName}: ${passed} test(s) passed, fewer than the ${floor} ${GATE_DECLARATION} pins for this gate`);
  }
  return errors;
}

/** R10REL-03: with more than one declared path, every path owes at least one passed test. */
export function pathCoverageErrors(gateName, report, paths, rootDir) {
  if (!report || !Array.isArray(report.testResults) || !Array.isArray(paths) || paths.length < 2) return [];
  const bases = [resolve(rootDir)];
  try { bases.push(realpathSync(rootDir)); } catch { /* the resolved spelling is enough */ }
  const passed = report.testResults
    .filter((result) => Array.isArray(result?.assertionResults) && result.assertionResults.some((test) => test?.status === 'passed'))
    .map((result) => String(result?.name ?? ''));
  const errors = [];
  for (const path of paths) {
    const targets = bases.map((base) => join(base, path));
    if (!passed.some((file) => targets.some((target) => file === target || file.startsWith(`${target}${sep}`)))) {
      errors.push(`${gateName}: the declared path ${path} contributed no passed test; each path a test gate declares owes at least one (R10REL-03)`);
    }
  }
  return errors;
}

export function runGate(gateName, { rootDir = process.cwd(), environment = process.env, spawn = spawnSync } = {}) {
  const root = resolve(rootDir);
  const { declaration, errors: loadErrors } = loadGateDeclaration(root);
  if (loadErrors.length) return { gate: gateName, status: null, errors: loadErrors, message: null };

  // R10REL-04: no result under a loader variable.
  const loaders = LOADER_VARIABLES.filter((name) => isText(environment?.[name]));
  if (loaders.length) return { gate: gateName, status: null, errors: [`${loaders.join(', ')}: set in the gate runner's own environment; a gate never reports a result under a loader variable (R10REL-04)`], message: null };

  // THE CONTROL CHECK IS NOT OPTIONAL AND NOT ORDERED LAST: no gate body runs in a repository whose
  // gate inputs are undeclared or edited.
  const controls = controlErrors(root, declaration);
  if (controls.length) return { gate: gateName, status: null, errors: controls, message: null };

  const gate = declaration.gates?.[gateName];
  if (!gate) {
    const declared = Object.keys(declaration.gates ?? {}).sort().join(', ');
    return { gate: gateName, status: null, errors: [`${gateName}: is not a gate ${GATE_DECLARATION} declares (declared: ${declared || 'none'})`], message: null };
  }
  if (gate.kind === 'controls') {
    return { gate: gateName, status: 0, errors: [], message: `every gate input this repository carries is declared and pinned (${Object.keys(declaration.controls ?? {}).length} controls checked)` };
  }

  let reportDirectory = null;
  let reportPath = null;
  if (gate.kind === 'vitest') {
    reportDirectory = mkdtempSync(join(tmpdir(), 'launch-gate-'));
    reportPath = join(reportDirectory, 'vitest-report.json');
  }
  try {
    const invocation = gateInvocation(root, gateName, declaration, { environment, reportPath });
    if (invocation.errors.length) return { gate: gateName, status: null, errors: invocation.errors, message: null };
    if (!invocation.command) return { gate: gateName, status: null, errors: [`${gateName}: no command could be resolved for this gate`], message: null };

    const child = spawn(invocation.command, invocation.args, {
      cwd: root,
      stdio: 'inherit',
      env: gateEnvironment(environment),
      shell: false,
    });
    if (!child || child.error) {
      return { gate: gateName, status: null, errors: [`${gateName}: could not be started (${child?.error instanceof Error ? child.error.message : 'spawn failed'})`], message: null };
    }
    if (child.signal) {
      return { gate: gateName, status: null, errors: [`${gateName}: was killed (${child.signal})`], message: null };
    }
    const errors = [];
    if (child.status !== 0) errors.push(`${gateName}: exited ${child.status}`);
    if (gate.kind === 'vitest') {
      let report = null;
      if (existsSync(reportPath)) {
        try {
          report = JSON.parse(readFileSync(reportPath, 'utf8'));
        } catch {
          report = null;
        }
      }
      errors.push(...testCountErrors(gateName, report, gate.minimumTests));
      errors.push(...pathCoverageErrors(gateName, report, gate.paths, root));
      if (errors.length === 0) {
        return { gate: gateName, status: 0, errors: [], message: `${report.numPassedTests} tests passed (at least ${gate.minimumTests ?? 1} required)` };
      }
    }
    if (errors.length) return { gate: gateName, status: child.status, errors, message: null };
    return { gate: gateName, status: 0, errors: [], message: 'the pinned command exited 0' };
  } finally {
    if (reportDirectory) rmSync(reportDirectory, { recursive: true, force: true });
  }
}

// R7REL-02: this CLI decides FOR ITSELF, by real path, whether it was invoked as a script. There
// is no shared helper any more: one `return false` in a common module turned every release CLI
// into a silent exit 0, in a file no delivered branch-protection plan reviewed and no delivered
// test covered. `ops/release/release-controls.test.mjs` runs every delivered CLI against a
// tampered fixture and requires exit 1, so a CLI that stops checking turns this project's CI red.
function invokedAsScript(moduleUrl) {
  const invoked = process.argv[1];
  if (typeof invoked !== 'string' || invoked.length === 0) return false;
  const real = (value) => {
    try {
      return realpathSync(value);
    } catch {
      return value;
    }
  };
  return real(fileURLToPath(moduleUrl)) === real(invoked);
}

if (invokedAsScript(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const rootDir = rootIndex >= 0 && args[rootIndex + 1] ? resolve(args[rootIndex + 1]) : process.cwd();
  const rootValueIndex = rootIndex >= 0 ? rootIndex + 1 : -1;
  const named = args.filter((argument, index) => !argument.startsWith('--') && index !== rootValueIndex);
  if (named.length !== 1) {
    process.stderr.write('usage: node ops/release/run-gate.mjs <gate> [--root <directory>]\n');
    process.exitCode = 1;
  } else {
    const result = runGate(named[0], { rootDir });
    if (result.errors.length) {
      for (const error of result.errors) process.stderr.write(`${error}\n`);
      process.stderr.write(`Gate ${named[0]} refused.\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`Gate ${named[0]}: ${result.message}\n`);
    }
  }
}
