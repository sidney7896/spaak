// Assert that this repository can actually run the workflows it ships.
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/check-project-scripts.mjs;
// ops/release/release.test.mjs asserts the two copies never diverge.
//
// R3-05: a generated project received the canonical workflows but not the package scripts and test
// directories they call, so eight of eleven `pnpm run` targets and all six `vitest run` directories
// were missing and every gate failed with a module/script resolution error on the first push. The
// gap sits between two lanes (the workflows are the release lane's, the scripts and the test
// scaffolding belong to the starter template), so this check makes it explicit and fail-closed: a
// repository whose package.json does not declare every script its own canonical workflows run fails
// its `workflow-validation` gate with the exact list, and can never reach production instead.
//
// `ops/release/package-scripts.json` is the standard's declaration of that contract; it must cover
// every reference the canonical workflows make, so a workflow cannot start calling an undeclared
// script unnoticed either.
//
// R8REL-02. Declaring the NAME was never enough. The canonical workflows pin `pnpm run lint`,
// `pnpm run smoke:production` and nine more, but what those names RUN lives in `package.json` - a
// file no control pinned, no test covered and no code-owner path reviewed. One word
// (`"smoke:production": "true"`) made the pre-promotion smoke gate vacuous while all three
// delivered controls stayed green, and the same edit silenced five of the thirteen required gates
// (`lint`, `typecheck`, `build`, `migrations`, `operational_readiness`), which are defined entirely
// in that file: a downgrade through DATA alone, with its diff outside every reviewed path. Each
// declared script now carries the exact `command` it must run, this gate refuses a divergence, and
// both branch-protection plans list `package.json`.
//
// R8REL-03. A green `ci-release-controls` did not mean the delivered self-test had run: one line in
// it (`const installed = false`) skipped sixteen of its seventeen cases and vitest still exited 0.
// This gate - which is required in both canonical workflows and which every other job needs - pins
// the self-test by digest, so a neutered self-test fails `workflow-validation` instead of reporting
// success about a control that no longer checks anything. The self-test asserts the same pin from
// its side, so neither file can be changed alone.
//
// D-025 / R9REL-01/02/03. The gates no longer run through `pnpm run <name>` at all: every gate step
// of every canonical workflow is `node ops/release/run-gate.mjs <gate>`, and what that gate runs is
// the argv array `ops/release/gates.json` declares. This gate therefore checks three more things,
// all of them in the job every other job needs:
//   - NO canonical workflow may still spell a gate as `pnpm run`, `pnpm exec`, `pnpm vitest`,
//     `pnpm -r` or with a bare `--` separator. pnpm 11.9.0 forwards that separator, which made the
//     required `migrations` gate red by construction in every generated project (R9REL-03).
//   - every gate a workflow names must exist in the declaration, and every gate the declaration
//     marks required must be named by a workflow, so a gate cannot quietly stop being run.
//   - the pinned package-script body and the declared gate argv must agree: the body a developer
//     runs by hand and the argv CI runs are one reviewed decision, not two that can drift.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DECLARATION_FILE = 'ops/release/package-scripts.json';
export const GATE_DECLARATION_FILE = 'ops/release/gates.json';
const WORKFLOW_DIRECTORY = '.github/workflows';

/**
 * R8REL-03. The delivered self-test of the release controls, pinned by content.
 *
 * `SELF_TEST_SHA256` is the sha256 of `ops/release/release-controls.test.mjs`, which is delivered
 * byte-identically from `starter/ci/ops-release/`. Changing the self-test therefore means changing
 * this constant in the same reviewed commit - both files are inside `ops/release/`, which both
 * branch-protection plans put under code-owner review - and a change to the self-test alone (a
 * skipped suite, a removed refusal case, a deleted file) fails this gate.
 * `ops/release/release.test.mjs` recomputes the pin, so the two can never drift apart silently.
 */
export const SELF_TEST_FILE = 'ops/release/release-controls.test.mjs';
export const SELF_TEST_SHA256 = 'c9c7ceb9f480ed578d0f8e67ae1854921a252a9fdd86b6750420b59cddd6ee2c';

/** Vitest markers that turn a case, a suite or a whole file off. None may appear in the self-test. */
const SELF_TEST_MARKERS = [/\.only\s*\(/, /\.skip\s*\(/, /\.todo\s*\(/, /\.concurrent\.skip\b/];

const PNPM_RUN = /\bpnpm run ([A-Za-z][A-Za-z0-9:_-]*)/g;
const VITEST_RUN = /\bpnpm (?:exec )?vitest run ([^\n]*)/g;
const RUN_GATE = /\bnode ops\/release\/run-gate\.mjs ([A-Za-z][A-Za-z0-9:_-]*)/g;
const TEST_DIRECTORY = /^tests\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * D-025. The spellings a canonical workflow may not contain any more, each with the measured reason.
 * They are matched against the workflow TEXT, which `validate-workflows.mjs` requires to be
 * byte-identical to a pinned, analysed template - so this list judges a reviewed artefact.
 */
const FORBIDDEN_INVOCATIONS = [
  [/\bpnpm\s+run\b/, 'a package-manager script layer: what "pnpm run <name>" executes is decided by package.json AND by pnpm-workspace.yaml\'s scriptShell, and three words in the second file turned every gate into exit 0 with the first byte-identical (R9REL-01)'],
  [/\bpnpm\s+exec\b/, 'a package-manager script layer (R9REL-01); a gate resolves its tool from the installed package by real path instead'],
  [/\bpnpm\s+vitest\b/, 'a test run without a pinned configuration: one vitest.config.js with passWithNoTests made a required gate green with zero tests executed (R9REL-02)'],
  [/\bpnpm\s+(?:-r|--recursive)\b/, 'a recursive package-manager script run; it is a gate body and belongs in ops/release/gates.json'],
  [/(^|\s)--(\s|$)/m, 'a bare "--" separator: pnpm 11.9.0 forwards it to the script, and every delivered ops script refuses the literal token, so the required migrations gate was red by construction (R9REL-03)'],
];

const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const unique = (values) => [...new Set(values)].sort();

/**
 * The gate declaration that sits BESIDE this module. In a generated project - and in the standard's
 * own `ops/release/` - that is the declaration of the workflows this copy governs, which is what
 * makes `collectReferences(texts)` meaningful without a second argument. `checkProjectScripts`
 * passes the declaration of the ROOT it is judging explicitly, so a project is always judged by its
 * own file and never by the one that happens to sit beside the checker.
 */
let siblingCache;
export function siblingGates() {
  if (siblingCache === undefined) {
    try {
      const parsed = JSON.parse(readFileSync(new URL('./gates.json', import.meta.url), 'utf8'));
      siblingCache = parsed && typeof parsed.gates === 'object' && !Array.isArray(parsed.gates) ? parsed.gates : {};
    } catch {
      siblingCache = {};
    }
  }
  return siblingCache;
}

/**
 * Extract every project script, test directory and gate the given workflow bodies invoke.
 *
 * A `node ops/release/run-gate.mjs <gate>` step contributes what that gate runs, resolved through
 * the declaration: the package script whose body it shares and the test directories it names. The
 * two legacy spellings are still collected, so a workflow that went back to them is judged rather
 * than silently read as invoking nothing.
 */
export function collectReferences(workflowTexts, gates = siblingGates()) {
  const scripts = [];
  const testDirectories = [];
  const named = [];
  const unknown = [];
  const declared = gates && typeof gates === 'object' ? gates : {};
  for (const text of Array.isArray(workflowTexts) ? workflowTexts : [workflowTexts]) {
    const body = String(text ?? '');
    for (const match of body.matchAll(RUN_GATE)) {
      const name = match[1];
      named.push(name);
      const gate = declared[name];
      if (!gate) {
        unknown.push(name);
        continue;
      }
      if (isText(gate.packageScript)) scripts.push(gate.packageScript);
      for (const directory of Array.isArray(gate.paths) ? gate.paths : []) {
        if (TEST_DIRECTORY.test(directory)) testDirectories.push(directory);
      }
    }
    for (const match of body.matchAll(PNPM_RUN)) scripts.push(match[1]);
    for (const match of body.matchAll(VITEST_RUN)) {
      for (const token of match[1].split(/\s+/)) {
        if (TEST_DIRECTORY.test(token)) testDirectories.push(token);
      }
    }
  }
  return { scripts: unique(scripts), testDirectories: unique(testDirectories), gates: unique(named), unknownGates: unique(unknown) };
}

/**
 * D-025: a canonical workflow runs gates through the runner and through nothing else.
 *
 * Whole-line YAML comments are removed first, because a workflow has to be allowed to EXPLAIN the
 * spellings it no longer uses. Nothing weaker is stripped: an inline `#` still counts, so a run
 * step that hides a forbidden spelling behind one is refused rather than parsed.
 */
export function workflowInvocationErrors(workflowFiles = []) {
  const errors = [];
  for (const [name, raw] of workflowFiles) {
    const text = String(raw ?? '').split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
    for (const [pattern, why] of FORBIDDEN_INVOCATIONS) {
      const found = pattern.exec(text);
      if (!found) continue;
      errors.push(`${WORKFLOW_DIRECTORY}/${name}: contains ${JSON.stringify(found[0].trim())}, which is ${why}; every gate and every ops step of a canonical workflow is "node ops/release/run-gate.mjs <gate>" (D-025)`);
    }
  }
  return errors;
}

/**
 * D-025: the body a developer runs by hand and the argv CI runs are ONE reviewed decision.
 *
 * The declared gate resolves to `node <script> <args>` or to `<tool> <args>`; the pinned package
 * script must start with that same head and may add only literal tokens the gate itself passes. One
 * word in package.json (`"smoke:production": "true"`) therefore fails here as well as against the
 * body pin, and a gates.json that silently started running a different script fails too.
 */
export function gateBodyErrors(gates = {}, declaredScripts = {}) {
  const errors = [];
  for (const [name, gate] of Object.entries(gates ?? {})) {
    const scriptName = gate?.packageScript;
    if (!isText(scriptName)) continue;
    const pinned = declaredScripts?.[scriptName]?.command;
    if (!isText(pinned)) continue;
    const head = gate.kind === 'ops' || gate.kind === 'control'
      ? ['node', String(gate.script ?? '')]
      : [String(gate.tool ?? '')];
    const tokens = pinned.trim().split(/\s+/);
    if (tokens.slice(0, head.length).join(' ') !== head.join(' ')) {
      errors.push(`${DECLARATION_FILE}: script "${scriptName}" pins the body ${JSON.stringify(pinned)}, but ${GATE_DECLARATION_FILE} runs the ${name} gate as ${JSON.stringify(head.join(' '))}; the gate a workflow runs and the body a developer runs must be the same decision`);
      continue;
    }
    const literals = new Set((Array.isArray(gate.argv) ? gate.argv : []).filter((argument) => typeof argument === 'string'));
    for (const token of tokens.slice(head.length)) {
      if (!literals.has(token)) {
        errors.push(`${DECLARATION_FILE}: script "${scriptName}" pins the argument ${JSON.stringify(token)}, which the ${name} gate of ${GATE_DECLARATION_FILE} does not pass`);
      }
    }
  }
  return errors;
}

export function projectScriptErrors({ references, declaration, packageScripts = {}, directoryExists = () => false, gates = siblingGates() } = {}) {
  const errors = [];
  for (const name of references?.unknownGates ?? []) {
    errors.push(`${GATE_DECLARATION_FILE}: a canonical workflow runs the gate ${name}, which this declaration does not define; the workflow would refuse at run time`);
  }
  const declaredGates = gates && typeof gates === 'object' ? gates : {};
  const invoked = new Set(references?.gates ?? []);
  for (const [name, gate] of Object.entries(declaredGates)) {
    if (gate?.required === true && !invoked.has(name)) {
      errors.push(`${GATE_DECLARATION_FILE}: the gate ${name} is declared required but no canonical workflow runs it; a required gate that nothing invokes is not a gate`);
    }
  }
  const declaredScripts = declaration && typeof declaration.scripts === 'object' && !Array.isArray(declaration.scripts) ? declaration.scripts : null;
  const declaredDirectories = Array.isArray(declaration?.testDirectories) ? declaration.testDirectories : null;
  if (!declaredScripts || !declaredDirectories) {
    return [`${DECLARATION_FILE}: must declare "scripts" (a mapping) and "testDirectories" (a list)`];
  }
  errors.push(...gateBodyErrors(declaredGates, declaredScripts));
  for (const name of references.scripts) {
    if (!Object.prototype.hasOwnProperty.call(declaredScripts, name)) {
      errors.push(`${DECLARATION_FILE}: does not declare the script ${name} that a canonical workflow runs`);
    }
  }
  for (const directory of references.testDirectories) {
    if (!declaredDirectories.includes(directory)) {
      errors.push(`${DECLARATION_FILE}: does not declare the test directory ${directory} that a canonical workflow runs`);
    }
  }
  for (const name of unique([...references.scripts, ...Object.keys(declaredScripts)])) {
    if (!isText(packageScripts[name])) {
      const purpose = declaredScripts[name]?.purpose ?? 'required by the canonical workflows';
      const suggested = declaredScripts[name]?.suggested;
      errors.push(`package.json: missing required script "${name}" - ${purpose}${suggested ? ` (for example: ${suggested})` : ''}`);
      continue;
    }
    // R8REL-02: the NAME existing proves nothing about what the gate runs. `pnpm run <name>` runs
    // whatever package.json says, so the body is pinned here and a divergence is a refusal. A
    // declaration entry without a `command` pins nothing and is itself an error: the pin may not be
    // switched off by deleting a field from the delivered declaration.
    const pinned = declaredScripts[name]?.command;
    if (!isText(pinned)) {
      errors.push(`${DECLARATION_FILE}: declares the script ${name} without a "command", so nothing pins what "pnpm run ${name}" actually runs`);
      continue;
    }
    if (packageScripts[name].trim() !== pinned.trim()) {
      errors.push(`package.json: script "${name}" runs ${JSON.stringify(packageScripts[name])}, not the ${JSON.stringify(pinned)} that ${DECLARATION_FILE} pins; the canonical workflows run "pnpm run ${name}", so the pinned body is what the gate executes and a project may not redefine it locally`);
    }
  }
  for (const directory of unique([...references.testDirectories, ...declaredDirectories])) {
    if (!directoryExists(directory)) {
      errors.push(`${directory}: the canonical workflows run vitest over this directory, but it does not exist`);
    }
  }
  return errors;
}

/**
 * R8REL-03. Is the delivered self-test of the release controls the one this gate pinned?
 *
 * The self-test is the only thing that makes a neutered release CLI visible in a generated
 * project's own CI. Until this check existed, `const installed = false` in it left sixteen of its
 * seventeen cases skipped, `ci-release-controls` green, and the required check reporting success
 * about a control that had stopped checking. Deleting the file, skipping a case and editing a
 * refusal are all a digest change and all fail here - in the gate every other job needs.
 */
export function selfTestErrors(rootDir = process.cwd(), { pin = SELF_TEST_SHA256 } = {}) {
  const path = join(resolve(rootDir), SELF_TEST_FILE);
  if (!existsSync(path)) {
    return [`${SELF_TEST_FILE}: the delivered self-test of the release controls is missing; without it a neutered release control reports success with an empty log`];
  }
  let content;
  try {
    content = readFileSync(path);
  } catch (error) {
    return [`${SELF_TEST_FILE}: cannot be read (${error instanceof Error ? error.message : 'unreadable'}), so the release controls carry no test`];
  }
  const errors = [];
  const text = content.toString('utf8');
  for (const marker of SELF_TEST_MARKERS) {
    const found = marker.exec(text);
    if (found) errors.push(`${SELF_TEST_FILE}: carries the vitest marker ${JSON.stringify(found[0])}, which switches a case or a suite off; the delivered self-test must run every case it declares`);
  }
  const digest = createHash('sha256').update(content).digest('hex');
  if (digest !== pin) {
    errors.push(`${SELF_TEST_FILE}: is ${digest.slice(0, 12)}, not the ${String(pin).slice(0, 12)} this gate pins; the delivered self-test of the release controls has been edited, so a green ci-release-controls no longer proves the controls were exercised`);
  }
  return errors;
}

/** The gate declaration of the repository being judged, never the one beside this checker. */
export function loadGates(rootDir = process.cwd()) {
  const path = join(resolve(rootDir), GATE_DECLARATION_FILE);
  if (!existsSync(path)) {
    return { gates: {}, errors: [`${GATE_DECLARATION_FILE}: the gate declaration is missing, so nothing says what the gates the canonical workflows run actually execute (D-025)`] };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed.gates !== 'object' || Array.isArray(parsed.gates)) {
      return { gates: {}, errors: [`${GATE_DECLARATION_FILE}: declares no "gates" mapping`] };
    }
    return { gates: parsed.gates, errors: [] };
  } catch (error) {
    return { gates: {}, errors: [`${GATE_DECLARATION_FILE}: is not valid JSON (${error instanceof Error ? error.message : 'parse error'})`] };
  }
}

export function checkProjectScripts(rootDir = process.cwd()) {
  const root = resolve(rootDir);
  // R8REL-03: computed first and added to EVERY outcome below, so no earlier refusal can return
  // before the self-test has been checked and no later one can leave it unchecked.
  const selfTest = selfTestErrors(root);
  const { gates, errors: gateErrors } = loadGates(root);
  selfTest.push(...gateErrors);
  const workflowDirectory = join(root, WORKFLOW_DIRECTORY);
  if (!existsSync(workflowDirectory)) return { errors: [...selfTest, `${WORKFLOW_DIRECTORY}: directory is missing`], references: { scripts: [], testDirectories: [], gates: [], unknownGates: [] } };
  const workflowFiles = readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .map((name) => [name, readFileSync(join(workflowDirectory, name), 'utf8')]);
  selfTest.push(...workflowInvocationErrors(workflowFiles));
  const references = collectReferences(workflowFiles.map(([, text]) => text), gates);
  const declarationPath = join(root, DECLARATION_FILE);
  if (!existsSync(declarationPath)) return { errors: [...selfTest, `${DECLARATION_FILE}: the required-script declaration is missing`], references };
  let declaration;
  try {
    declaration = JSON.parse(readFileSync(declarationPath, 'utf8'));
  } catch (error) {
    return { errors: [...selfTest, `${DECLARATION_FILE}: is not valid JSON (${error instanceof Error ? error.message : 'parse error'})`], references };
  }
  const packagePath = join(root, 'package.json');
  let packageScripts = {};
  if (!existsSync(packagePath)) return { errors: [...selfTest, 'package.json: is missing'], references };
  try {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8'));
    packageScripts = parsed && typeof parsed.scripts === 'object' && !Array.isArray(parsed.scripts) ? parsed.scripts : {};
  } catch (error) {
    return { errors: [...selfTest, `package.json: is not valid JSON (${error instanceof Error ? error.message : 'parse error'})`], references };
  }
  const directoryExists = (directory) => {
    const path = join(root, directory);
    return existsSync(path) && statSync(path).isDirectory();
  };
  return { errors: [...selfTest, ...projectScriptErrors({ references, declaration, packageScripts, directoryExists, gates })], references };
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
  const positional = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
  const result = checkProjectScripts(positional ? resolve(positional) : process.cwd());
  if (result.errors.length) {
    for (const error of result.errors) process.stderr.write(`${error}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Project provides all ${result.references.scripts.length} scripts and ${result.references.testDirectories.length} test directories its workflows run\n`);
  }
}
