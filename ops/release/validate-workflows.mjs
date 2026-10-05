// Release-workflow ALLOWLIST validator (decision D-014).
//
// This file is copied BYTE-IDENTICALLY to starter/ci/ops-release/validate-workflows.mjs so a
// generated project runs exactly the guarantees the monorepo tests prove. ops/release/release.test.mjs
// asserts the two copies never diverge and runs every adversarial fixture against both of them.
// It must stay self-contained: node: builtins only, no `yaml`, no package import (R3-04).
//
// WHY AN ALLOWLIST. Three review rounds showed that "prove an arbitrary workflow safe" is an arms
// race: workflow-level `env:` hid deployment secrets from a per-job classifier (R3-01) and an
// expression-valued `continue-on-error` neutralised all thirteen gates while the structural
// validator still exited 0 (R3-02). The rule is now the other way round: a managed repository may
// contain ONLY the canonical workflows. `ops/release/workflow-templates/` holds the canonical
// source for this repository (in a generated project it is the byte-identical delivery of
// `starter/ci/workflows/`), every file under `.github/workflows/` must be byte-identical to a
// canonical rendering, and an extra, missing or modified file fails.
//
// R4-01. Byte equality against a file the same commit can write is necessary but NOT sufficient:
// editing a template together with its rendering validated clean, and the structural analysis that
// would have caught it was exported and never called by the gate, so in a generated project - which
// receives no test file - it was dead code. The gate therefore verifies the canonical template SET
// against a checked-in digest manifest (`ops/release/workflow-templates.sha256`), PARSES every
// canonical template with the small fail-closed reader below and runs `validateWorkflowDocument`
// over it, and requires every file under `.github/workflows/` to be byte-identical to a rendering
// of a pinned, analysed template.
//
// R5-01. That was still SELF-CERTIFYING. The analysis is per document and looks for the required
// gates as JOB IDS in the same file, so a new `hotfix.yml` that brought thirteen `run: "true"` stub
// jobs named after the gates satisfied it, and adding its digest to the manifest cost one line: a
// production-deploying, secret-bearing workflow passed every gate of a real generated project
// (measured, exit 0). Two rules now make "canonical" a property of the SET:
//
//   CAPABILITY RULE. Over the WHOLE workflow directory and the WHOLE template directory, before any
//   digest is checked: only `CANONICAL_WORKFLOW_NAMES` may exist there at all, only `RELEASE_WORKFLOW`
//   may carry production capability (`environment: production`, a production-class secret, a
//   production deploy command, `permissions:` beyond read), only its `PRODUCTION_JOBS` may, and no
//   workflow other than it may declare a job whose id is a required-gate name. A required gate
//   counts only when its job actually runs the canonical gate steps: a `run: "true"` stub is not a
//   gate. Those four constants live in `release-policy.mjs` and are NOT read from the repository.
//
//   PROVENANCE RULE. In a generated project the digest manifest and the release policy are
//   DELIVERED artefacts, so the gate recomputes `releaseControlsDigest` over them and compares it
//   with the digest the standard pinned for the template version recorded in the project's launch
//   manifest (`.project-launch-starter.json`). Editing the manifest, the template and the policy
//   together in one commit therefore still fails: the downgrade has to be written into the gate's
//   own source (and into the launch manifest field the delivered branch-protection plan lists as
//   requiring code-owner review).
//
//   R6REL-01. That rule FAILED OPEN on the one input it depends on: it asked whether
//   `.project-launch-starter.json` exists and switched itself off when it did not, so `rm` on that
//   one file turned the whole provenance rule into a no-op and a generated project whose delivered
//   policy had been cut to a single gate validated clean (measured by the sixth review, exit 0).
//   Two changes, both here:
//
//     WHAT THIS REPOSITORY IS is decided by the DELIVERED LAYOUT, never by the presence of the file
//     being checked (`repositoryKind`). A generated project is recognised by the control files the
//     generator delivers into `ops/release/` and the standard never has; the standard itself is
//     recognised POSITIVELY by its own sources (`standard/policy/`, `starter/`). A repository that
//     carries both, or neither, is refused instead of validated as whichever is convenient. In a
//     generated project a missing, unreadable, corrupt or `templateVersion`-less launch manifest is
//     now a gate failure that names the file.
//
//     GATE-SET RULE. `release.required_gates` is data in the repository being validated, so the
//     structural analysis it feeds could be shrunk by editing that file. The canonical gate set is
//     pinned in `release-policy.mjs` (`CANONICAL_REQUIRED_GATES`); a policy file may add gates and
//     may never omit one. This rule is independent of the provenance rule: it fails on a downgraded
//     policy even when the launch manifest is gone and even when the digest pin has been rewritten.
//
//   R7REL-01. `repositoryKind` was still a question about DATA: four "delivered" marker files and
//   four "standard" marker files, all of them recognised by `existsSync` alone. A generated project
//   that MOVED its delivered markers aside and touched four empty files in their place was
//   classified as the standard, which switched the provenance rule off and let thirteen gate
//   commands be rewritten to `... || true` (measured by the seventh review, exit 0). Both halves of
//   that question are replaced:
//
//     GENERATED is the DEFAULT, and it is positive: a tree carrying a launch manifest OR any one of
//     `DELIVERED_CONTROL_MARKERS` is a generated project and must prove its provenance. The marker
//     list is now every control file the generator delivers that the standard itself does not carry
//     (release.test.mjs derives it from `starter/template.files.json` so a new delivered control
//     cannot escape it). Two of them - `.github/workflows/release.yml` and
//     `ops/release/workflow-templates/release.yml` - cannot be relocated at all without losing the
//     production pipeline the attack exists to run, because a rendered workflow without its
//     canonical template, or a template without its rendering, is a gate failure in its own right.
//
//     STANDARD is no longer inferable from files at all. It exists only when `standard/check-standard.mjs`
//     is present AND this gate RUNS it AND it exits 0 - i.e. when the tree passes the standard's own
//     full check (its pinned policy sets, its 57 decisions, its traceability). A tree that is
//     neither is refused, and the gate PRINTS which mode it chose and why.
//
//   R8REL-04. "Executable code under standard/**" was the claimed price of that mode, and the
//   measured price was `touch`: an empty `.mjs` file exits 0, so `: > standard/check-standard.mjs`
//   in a tree stripped of its delivered markers gave `Repository mode: standard`, switched the
//   provenance rule off and validated thirteen gate commands rewritten to `... || true`, exit 0.
//   The check file is now pinned by CONTENT (`STANDARD_CHECK_SHA256`) and compared BEFORE it is
//   executed: the only program this gate will run there is the standard's own check, which then
//   still has to exit 0. Planting `standard` mode costs reproducing the standard, and a stub is
//   refused without being run at all.
//
// WHAT THIS DOES NOT DO. It cannot defend a repository against someone who can commit anything they
// like to it: such a person can edit this file. The delivered controls claim exactly two things,
// and `docs/release/README.md` states them in those words: (a) no downgrade is possible through
// DATA alone, and (b) every code path a downgrade would need is under code-owner review in the
// delivered branch-protection plan. Branch protection and review carry that residual risk; the plan
// for them is `ops/release/branch-protection.plan.json` (D-014, R4-06, R5-03).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_REQUIRED_GATES,
  CANONICAL_WORKFLOW_NAMES,
  PRODUCTION_JOBS,
  PRODUCTION_JOB_DEPENDENCIES,
  RELEASE_WORKFLOW,
  isProductionSecret,
  loadReleasePolicy,
} from './release-policy.mjs';

export const TEMPLATE_DIRECTORY = 'ops/release/workflow-templates';
export const TEMPLATE_MANIFEST = 'ops/release/workflow-templates.sha256';
export const WORKFLOW_DIRECTORY = '.github/workflows';
export const PARAMETER_FILE = 'ops/release/workflow-params.json';
export const PROJECT_POLICY = 'ops/release/global-policy.yaml';
/** Written by starter/create-project.mjs. Its presence is CHECKED, never used to decide what this
 * repository is: R6REL-01 was exactly the rule "no manifest, so no generated project, so no check". */
export const LAUNCH_MANIFEST = '.project-launch-starter.json';

/**
 * R6REL-01 / R7REL-01. Release controls the generator DELIVERS (see the `ci` allowlist of
 * `starter/template.files.json`) and that the standard itself never carries: its policy lives in
 * `standard/policy/`, its promotion/gate/rollback contracts come from `packages/core` rather than
 * self-contained `core-*.mjs` copies, and it renders no `release.yml` at all. Any ONE of them
 * present means "this tree is a delivered project", whatever else it carries.
 *
 * They are load-bearing, not decorative, which is what makes relocating them expensive:
 *   - `global-policy.yaml` is the policy the release path reads and the artefact the provenance
 *     digest pins; the three `core-*.mjs` modules are what the delivered `evaluate-gates.mjs`,
 *     `check-promotion.mjs` and `decide-rollback.mjs` import, so moving them breaks the gates job,
 *     the promotion check and the rollback decision on the way;
 *   - `.github/workflows/release.yml` and `ops/release/workflow-templates/release.yml` are the
 *     production pipeline and its canonical source. Removing either one is refused below (a
 *     rendering without a pinned template, or a pinned template without its rendering), so a tree
 *     cannot stop looking generated while keeping the ability to promote to production.
 *
 * release.test.mjs derives this list from `starter/template.files.json` minus the paths the
 * standard itself carries, so a control file added to the delivery cannot silently escape it.
 */
export const DELIVERED_CONTROL_MARKERS = [
  '.github/workflows/release.yml',
  'ops/release/README.md',
  'ops/release/core-can-promote.mjs',
  'ops/release/core-decide-rollback.mjs',
  'ops/release/core-evaluate-gates.mjs',
  'ops/release/global-policy.yaml',
  'ops/release/workflow-templates/release.yml',
];

/**
 * R7REL-01. The standard's own full self-check. `standard` mode is not a set of files any tree can
 * touch into existence: it is the exit status of THIS program, run by the gate. The standard check
 * verifies the pinned policy sets, the schemas, the approver registry, the 57 decisions and the
 * AT-01..AT-30 traceability, so a planted copy has to be the standard.
 */
export const STANDARD_CHECK = 'standard/check-standard.mjs';

/**
 * R8REL-04. `standard` mode used to be the exit status alone, and the cheapest program that exits 0
 * is a file of zero bytes: `: > standard/check-standard.mjs` in a tree stripped of its delivered
 * markers produced `Repository mode: standard`, switched the provenance rule off and validated
 * thirteen gate commands rewritten to `... || true`, exit 0 - measured by the eighth review. The
 * eighth round's price for `standard` was `touch`, not "executable code under standard/**".
 *
 * The check file is therefore pinned by CONTENT first: it must be byte-identical to the standard's
 * own `standard/check-standard.mjs` before it is run at all. A stub - empty, `process.exit(0)`, or
 * any other program - is refused without being executed, and the only file that passes is the real
 * check, which then still has to EXIT 0, which means passing the standard's decisions, schemas,
 * policy sets and traceability. Planting `standard` mode now costs reproducing the standard.
 *
 * `ops/release/release.test.mjs` recomputes this digest from `standard/check-standard.mjs`, so the
 * monorepo's own suite goes red the moment the standard's check changes without a reviewed update
 * here - the pin cannot drift silently, in either direction.
 */
export const STANDARD_CHECK_SHA256 = 'e802da6113cf93d1792622e3b53ecf812e07132725c6c8e143d7a262a8785763';

/** R10REL-01: digest of the standard's own ops/release/ plus its policy. */
export const STANDARD_RELEASE_CONTROLS_SHA256 = 'abc882a8d68e7bba8ce019aab6a0ef87e7ce7b719e96f6881aa3c3877f8ed7da';

/** How long the standard check may take before the gate treats it as "could not be established". */
export const STANDARD_CHECK_TIMEOUT_MS = 120000;

/**
 * R8REL-07. The environment the standard check is spawned with. The child used to inherit the whole
 * environment of the validation job; it is a program from the tree being judged, so it is given
 * exactly what Node needs to start and nothing that belongs to the run around it.
 */
function minimalEnvironment(environment = process.env) {
  const passed = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'SystemRoot', 'ComSpec']) {
    if (typeof environment[name] === 'string' && environment[name] !== '') passed[name] = environment[name];
  }
  return passed;
}

/**
 * Run the standard's own check in `rootDir`. Only the exit STATUS crosses back: the child's output
 * is deliberately not quoted anywhere, because a module-resolution message from a child would
 * otherwise read as this gate needing an installed package (R3-04).
 *
 * R8REL-04: the file is compared with `STANDARD_CHECK_SHA256` BEFORE it is executed, so a tree that
 * is not the standard never gets to run a program of its own here at all.
 * R8REL-07: the child is spawned with a minimal environment rather than the validation job's.
 */
export function runStandardCheck(rootDir, spawn = spawnSync, { pin = STANDARD_CHECK_SHA256 } = {}) {
  const root = resolve(rootDir);
  const script = join(root, STANDARD_CHECK);
  if (!existsSync(script)) return { ok: false, present: false, status: null, reason: 'absent' };
  let digest;
  try {
    digest = createHash('sha256').update(readFileSync(script)).digest('hex');
  } catch {
    return { ok: false, present: true, status: null, reason: 'could not be read' };
  }
  if (digest !== pin) {
    return { ok: false, present: true, status: null, digest, reason: `is ${digest.slice(0, 12)}, not the standard's own check (${String(pin).slice(0, 12)}), so it was not run` };
  }
  let result;
  try {
    result = spawn(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: STANDARD_CHECK_TIMEOUT_MS, stdio: 'pipe', env: minimalEnvironment() });
  } catch {
    return { ok: false, present: true, status: null, digest, reason: 'could not be started' };
  }
  if (!result || result.error) return { ok: false, present: true, status: null, digest, reason: 'could not be started' };
  if (result.signal) return { ok: false, present: true, status: null, digest, reason: `was killed (${result.signal})` };
  if (result.status !== 0) return { ok: false, present: true, status: result.status, digest, reason: `exited ${result.status}` };
  return { ok: true, present: true, status: 0, digest, reason: 'is the standard\'s own check and exited 0' };
}

/**
 * R7REL-01. Is this a project generated from the standard, the standard itself, or neither?
 *
 * Generated is the default and is decided positively: a launch manifest or any delivered control
 * file. Standard exists only when the standard's own check RUNS here and exits 0. Neither is a
 * refusal, never a silent exemption. `why` is printed by the CLI, so a log always says which mode
 * the gate chose and on what evidence.
 */
export function repositoryKind(rootDir, { standardCheck = runStandardCheck } = {}) {
  const root = resolve(rootDir);
  const delivered = DELIVERED_CONTROL_MARKERS.filter((path) => existsSync(join(root, path)));
  const manifest = existsSync(join(root, LAUNCH_MANIFEST));
  if (manifest || delivered.length > 0) {
    const evidence = [...(manifest ? [LAUNCH_MANIFEST] : []), ...delivered];
    return { kind: 'generated', delivered, manifest, check: null, why: `it carries ${evidence.join(', ')}` };
  }
  // Asked at most once per validation run: `provenanceErrors` is the only caller inside the gate,
  // and the answer is deliberately NOT cached across calls - a cached "absent" would outlive the
  // file appearing, which is the class of stale-answer bug this whole rule exists to remove.
  const check = standardCheck(root);
  if (check.ok) return { kind: 'standard', delivered, manifest, check, why: `${STANDARD_CHECK} is byte-identical to the standard's pinned check and exited 0 here` };
  const why = check.present
    ? `it carries no launch manifest and no delivered release control, and ${STANDARD_CHECK} ${check.reason}`
    : `it carries no launch manifest, no delivered release control (${DELIVERED_CONTROL_MARKERS.join(', ')}) and no ${STANDARD_CHECK} to prove it is the standard`;
  return { kind: 'unknown', delivered, manifest, check, why };
}

/**
 * R5-01 (provenance). The digest the STANDARD pins for the release controls it delivers, per
 * starter template version. `releaseControlsDigest` recomputes it from the project's own
 * `ops/release/workflow-templates.sha256` and `ops/release/global-policy.yaml`, so a generated
 * project whose controls were edited fails even when manifest, template and policy moved together.
 * ops/release/release.test.mjs recomputes this constant from starter/ci/ops-release/ and fails when
 * the delivered controls change without a reviewed update here.
 *
 * THE VERSION RULE (W05g). One entry per starter template version, keyed by the `templateVersion`
 * the generator stamps into a project's launch manifest from `starter/VERSION`, and entries are
 * never removed - a project generated from an older standard keeps validating against the controls
 * it actually received. Which of the two happens when the delivered controls change:
 *
 *   - `starter/VERSION` has been used to generate a project outside this repository: bump it
 *     (minor for a controls change, major for one that needs operator action), ADD the new version
 *     with the new digest and leave every older entry untouched.
 *   - it has not: the version is still a draft, there is no project in the world stamped with it,
 *     and a second entry would pin a standard nobody was ever delivered. The entry for the current
 *     `starter/VERSION` is then regenerated in place, in the same reviewed commit as the controls.
 *
 * 1.0.0 is in the second state today - the standard is still in review rounds, AT-16 is open and
 * `starter/tests/create-project.test.mjs` pins `templateVersion: "1.0.0"` - so this packet
 * regenerated its digest rather than adding 1.1.0 beside it. `starter/VERSION` is outside this
 * packet's owned paths; ops/release/WORKER-REPORT.md carries the bump request for the first real
 * delivery, and the release suite fails if the pin and the delivered controls ever disagree.
 */
export const DELIVERED_RELEASE_CONTROLS = new Map([
  ['1.0.0', '030ea3033f1d12788dfce7aec7a311fb62509524cbf09bf3e354c38c56d06311'],
]);

const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g;
// A parameter value is substituted into YAML that is then executed by GitHub Actions. It is
// restricted to a single plain token: no newline, no quote, no backslash, no `$`, no `{`/`}`, so a
// parameter can never introduce an expression, a second key or a shell command.
const PARAMETER_VALUE = /^[A-Za-z0-9._/:@-][A-Za-z0-9 ._/:@-]{0,63}$/;
// R4-07: the old check was line-anchored, so the flow spelling `steps: [{ uses: ./... }]` escaped
// it. This one matches a `uses:` anywhere on a line; the parsed analysis below catches both shapes
// independently, so a spelling trick now has to defeat a parser rather than a regex.
const LOCAL_ACTION = /(?:^|[\s{[,])uses:\s*["']?\.{1,2}\//m;

const UNSAFE_EVENTS = new Set(['pull_request', 'pull_request_target', 'workflow_run', 'issue_comment']);

// GITHUB_TOKEN is minted per run and scoped by `permissions:`; every other secret is treated as a
// deployment secret, so a job that reads one is production-affecting even without an `environment:`.
const NON_PRODUCTION_SECRETS = new Set(['GITHUB_TOKEN']);

const DEPLOY_ACTION = /\b(?:promote|deploy|publish|release|vercel|netlify|wrangler|flyctl|migration:apply|migrate:deploy|db:push)\b/i;
const RECOVERY_ACTION = /\b(?:rollback|revert)\b/i;
const MENTIONS_PRODUCTION = /\bprod(?:uction)?\b|--prod\b/i;

const BRANCH_TERM = /^github\.(?:ref|ref_name|event_name|repository|base_ref)\s*(?:==|!=)\s*(?:'[^']*'|"[^"]*")$/;
const SUCCESS_TERM = /^needs\.([A-Za-z0-9_-]+)\.result\s*==\s*(?:'success'|"success")$/;
const FAILURE_TERM = /^needs\.([A-Za-z0-9_-]+)\.result\s*==\s*(?:'failure'|"failure")$/;
const ALWAYS_TERM = /^always\s*\(\s*\)$/;

// =================================================================================================
// A MINIMAL, FAIL-CLOSED YAML READER (R4-01).
//
// R3-04 forbids importing `yaml` here: every release helper runs in a job that only checks the
// repository out. The gate still has to understand a workflow, so this reader covers exactly the
// subset the canonical templates use - block mappings and sequences, flow mappings and sequences,
// plain and quoted scalars, literal block scalars - and REFUSES everything else (anchors, aliases,
// merge keys, tags, folded scalars, multiple documents, directives, tabs, duplicate keys). A
// canonical template that needs one of those is rejected rather than half-understood, and
// release.test.mjs asserts this reader agrees with the `yaml` package on every canonical workflow
// and every adversarial fixture, so a divergence is a test failure rather than a silent bypass.
// =================================================================================================

export class WorkflowYamlError extends Error {}

const BLOCK_SCALAR_HEADER = /^\|([-+]?)$/;
const RESERVED_START = /^[&*!%`@]/;

function stripComment(line) {
  let single = false;
  let double = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (single) {
      if (character === "'") {
        if (line[index + 1] === "'") index += 1;
        else single = false;
      }
      continue;
    }
    if (double) {
      if (character === '\\') index += 1;
      else if (character === '"') double = false;
      continue;
    }
    if (character === "'") { single = true; continue; }
    if (character === '"') { double = true; continue; }
    if (character === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
}

function quotedEnd(text, start, source) {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    if (quote === '"' && text[index] === '\\') { index += 2; continue; }
    if (text[index] === quote) {
      if (quote === "'" && text[index + 1] === "'") { index += 2; continue; }
      return index;
    }
    index += 1;
  }
  throw new WorkflowYamlError(`${source}: unterminated quoted scalar`);
}

function unescapeDouble(text, source) {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\\') { out += text[index]; continue; }
    const next = text[index + 1];
    index += 1;
    if (next === 'n') out += '\n';
    else if (next === 't') out += '\t';
    else if (next === 'r') out += '\r';
    else if (next === '"' || next === '\\' || next === '/' || next === ' ') out += next;
    else throw new WorkflowYamlError(`${source}: unsupported escape \\${next ?? ''} in a double-quoted scalar`);
  }
  return out;
}

/** Decode a scalar that is entirely quoted; returns undefined when the text is not quoted. */
function quotedScalar(text, source) {
  const quote = text[0];
  if (quote !== '"' && quote !== "'") return undefined;
  const end = quotedEnd(text, 0, source);
  if (text.slice(end + 1).trim() !== '') throw new WorkflowYamlError(`${source}: unsupported content after a quoted scalar`);
  const inner = text.slice(1, end);
  return quote === "'" ? inner.replaceAll("''", "'") : unescapeDouble(inner, source);
}

/** YAML 1.2 core-schema resolution of a plain scalar, so this reader agrees with the yaml package. */
function resolvePlain(text) {
  if (text === '' || text === '~' || text === 'null' || text === 'Null' || text === 'NULL') return null;
  if (text === 'true' || text === 'True' || text === 'TRUE') return true;
  if (text === 'false' || text === 'False' || text === 'FALSE') return false;
  if (/^[-+]?\d+$/.test(text)) {
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : text;
  }
  if (/^0o[0-7]+$/.test(text)) return Number.parseInt(text.slice(2), 8);
  if (/^0x[0-9a-fA-F]+$/.test(text)) return Number.parseInt(text.slice(2), 16);
  if (/^[-+]?(?:\.\d+|\d+(?:\.\d*)?)(?:[eE][-+]?\d+)?$/.test(text)) return Number(text);
  if (/^[-+]?\.(?:inf|Inf|INF)$/.test(text)) return text.startsWith('-') ? -Infinity : Infinity;
  if (/^\.(?:nan|NaN|NAN)$/.test(text)) return Number.NaN;
  return text;
}

function refuseReserved(text, source) {
  if (RESERVED_START.test(text)) {
    throw new WorkflowYamlError(`${source}: anchors, aliases, tags and reserved indicators are not supported in a canonical workflow (${text.slice(0, 24)})`);
  }
}

function skipFlowSpace(state) {
  while (state.index < state.text.length && /\s/.test(state.text[state.index])) state.index += 1;
}

function parseFlowScalar(state, isKey) {
  skipFlowSpace(state);
  const { text, source } = state;
  const character = text[state.index];
  if (character === '"' || character === "'") {
    const end = quotedEnd(text, state.index, source);
    const raw = text.slice(state.index, end + 1);
    state.index = end + 1;
    return quotedScalar(raw, source);
  }
  let end = state.index;
  while (end < text.length && !',}]'.includes(text[end])) {
    if (isKey && text[end] === ':' && (end + 1 >= text.length || /[\s,}\]]/.test(text[end + 1]))) break;
    end += 1;
  }
  const raw = text.slice(state.index, end).trim();
  state.index = end;
  if (raw === '') throw new WorkflowYamlError(`${source}: empty entry in a flow collection`);
  refuseReserved(raw, source);
  return resolvePlain(raw);
}

function parseFlowNode(state) {
  skipFlowSpace(state);
  const character = state.text[state.index];
  if (character === '{') return parseFlowMapping(state);
  if (character === '[') return parseFlowSequence(state);
  return parseFlowScalar(state, false);
}

function parseFlowMapping(state) {
  state.index += 1;
  const result = {};
  skipFlowSpace(state);
  if (state.text[state.index] === '}') { state.index += 1; return result; }
  for (;;) {
    const key = String(parseFlowScalar(state, true));
    skipFlowSpace(state);
    if (state.text[state.index] !== ':') throw new WorkflowYamlError(`${state.source}: expected ':' in a flow mapping`);
    state.index += 1;
    if (key === '<<') throw new WorkflowYamlError(`${state.source}: merge keys are not supported in a canonical workflow`);
    if (Object.prototype.hasOwnProperty.call(result, key)) throw new WorkflowYamlError(`${state.source}: duplicate key ${key} in a flow mapping`);
    result[key] = parseFlowNode(state);
    skipFlowSpace(state);
    const character = state.text[state.index];
    if (character === ',') {
      state.index += 1;
      skipFlowSpace(state);
      if (state.text[state.index] === '}') { state.index += 1; return result; }
      continue;
    }
    if (character === '}') { state.index += 1; return result; }
    throw new WorkflowYamlError(`${state.source}: malformed flow mapping`);
  }
}

function parseFlowSequence(state) {
  state.index += 1;
  const result = [];
  skipFlowSpace(state);
  if (state.text[state.index] === ']') { state.index += 1; return result; }
  for (;;) {
    result.push(parseFlowNode(state));
    skipFlowSpace(state);
    const character = state.text[state.index];
    if (character === ',') {
      state.index += 1;
      skipFlowSpace(state);
      if (state.text[state.index] === ']') { state.index += 1; return result; }
      continue;
    }
    if (character === ']') { state.index += 1; return result; }
    throw new WorkflowYamlError(`${state.source}: malformed flow sequence`);
  }
}

/**
 * Does an UNQUOTED plain scalar contain a `key: value` pair at flow depth zero? Unlike
 * `mappingKeyEnd` this never inspects quotes - a plain scalar may legitimately contain an
 * apostrophe ("the standard's gates") and must not be read as an unterminated quoted scalar.
 */
function startsCompactMapping(text) {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') depth -= 1;
    else if (character === ':' && depth === 0 && (index + 1 >= text.length || /\s/.test(text[index + 1]))) return true;
  }
  return false;
}

function parseScalarValue(text, source) {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (trimmed[0] === '{' || trimmed[0] === '[') {
    const state = { text: trimmed, index: 0, source };
    const value = parseFlowNode(state);
    skipFlowSpace(state);
    if (state.index < trimmed.length) throw new WorkflowYamlError(`${source}: trailing content after a flow collection`);
    return value;
  }
  const quoted = quotedScalar(trimmed, source);
  if (quoted !== undefined) return quoted;
  refuseReserved(trimmed, source);
  // R5-05: `a: foo: bar` used to be accepted as the string "foo: bar"; the yaml package and GitHub
  // both refuse the document ("Nested mappings are not allowed in compact mappings"). A canonical
  // template that contains one is a failing template, not a differently-understood one.
  if (startsCompactMapping(trimmed)) {
    throw new WorkflowYamlError(`${source}: nested mappings are not allowed in a compact mapping (${trimmed.slice(0, 40)})`);
  }
  return resolvePlain(trimmed);
}

/** Index of the `:` that terminates a mapping key, or -1 when the line is not a mapping entry. */
function mappingKeyEnd(body, source) {
  let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === '"' || character === "'") { index = quotedEnd(body, index, source); continue; }
    if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') depth -= 1;
    else if (character === ':' && depth === 0 && (index + 1 >= body.length || /\s/.test(body[index + 1]))) return index;
  }
  return -1;
}

function bodyOf(line, source) {
  return stripComment(line.raw, source).slice(line.indent).trimEnd();
}

function skipBlank(context, from) {
  let index = from;
  while (index < context.lines.length && bodyOf(context.lines[index], context.source) === '') index += 1;
  return index;
}

function readBlockScalar(context, parentIndent, chomp) {
  const collected = [];
  let baseIndent = 0;
  while (context.i < context.lines.length) {
    const line = context.lines[context.i];
    const blank = line.raw.trim() === '';
    if (!blank && line.indent <= parentIndent) break;
    if (!blank && !baseIndent) baseIndent = line.indent;
    collected.push(blank ? '' : line.raw.slice(baseIndent));
    context.i += 1;
  }
  let trailing = 0;
  while (collected.length && collected.at(-1) === '') { collected.pop(); trailing += 1; }
  const text = collected.join('\n');
  if (chomp === '-') return text;
  if (chomp === '+') return collected.length ? `${text}\n${'\n'.repeat(trailing)}` : '\n'.repeat(trailing);
  return collected.length ? `${text}\n` : '';
}

function parseBlockSequence(context, indent) {
  const items = [];
  for (;;) {
    context.i = skipBlank(context, context.i);
    if (context.i >= context.lines.length) break;
    const line = context.lines[context.i];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new WorkflowYamlError(`${context.source}: line ${line.number} is indented unexpectedly`);
    const body = bodyOf(line, context.source);
    if (body !== '-' && !body.startsWith('- ')) break;
    if (body === '-') {
      context.i += 1;
      items.push(parseBlockNode(context, indent + 1));
      continue;
    }
    const rest = body.slice(1);
    const lead = /^\s*/.exec(rest)[0].length;
    const column = indent + 1 + lead;
    context.lines[context.i] = { raw: ' '.repeat(column) + line.raw.slice(column), number: line.number, indent: column };
    items.push(parseBlockNode(context, column));
  }
  return items;
}

function parseBlockMapping(context, indent) {
  const result = {};
  for (;;) {
    context.i = skipBlank(context, context.i);
    if (context.i >= context.lines.length) break;
    const line = context.lines[context.i];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new WorkflowYamlError(`${context.source}: line ${line.number} is indented unexpectedly`);
    const body = bodyOf(line, context.source);
    if (body === '-' || body.startsWith('- ')) break;
    const keyEnd = mappingKeyEnd(body, context.source);
    if (keyEnd < 0) throw new WorkflowYamlError(`${context.source}: line ${line.number} is not a mapping entry (${body.slice(0, 40)})`);
    const rawKey = body.slice(0, keyEnd).trim();
    if (rawKey === '<<') throw new WorkflowYamlError(`${context.source}: merge keys are not supported in a canonical workflow`);
    if (rawKey.startsWith('?')) throw new WorkflowYamlError(`${context.source}: explicit complex keys are not supported in a canonical workflow`);
    refuseReserved(rawKey, context.source);
    const quoted = quotedScalar(rawKey, context.source);
    const key = String(quoted === undefined ? rawKey : quoted);
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new WorkflowYamlError(`${context.source}: duplicate key ${key} at line ${line.number}`);
    }
    const rest = body.slice(keyEnd + 1).trim();
    context.i += 1;
    if (rest === '') {
      result[key] = parseBlockNode(context, indent + 1);
      continue;
    }
    const header = BLOCK_SCALAR_HEADER.exec(rest);
    if (header) { result[key] = readBlockScalar(context, indent, header[1]); continue; }
    if (/^[|>]/.test(rest)) {
      throw new WorkflowYamlError(`${context.source}: only the literal block scalar (|, |-, |+) is supported in a canonical workflow (${rest})`);
    }
    result[key] = parseScalarValue(rest, context.source);
  }
  return result;
}

function parseBlockNode(context, indent) {
  context.i = skipBlank(context, context.i);
  if (context.i >= context.lines.length) return null;
  const line = context.lines[context.i];
  if (line.indent < indent) return null;
  const body = bodyOf(line, context.source);
  if (body === '-' || body.startsWith('- ')) return parseBlockSequence(context, line.indent);
  if (mappingKeyEnd(body, context.source) < 0) {
    context.i += 1;
    const header = BLOCK_SCALAR_HEADER.exec(body);
    if (header) return readBlockScalar(context, line.indent, header[1]);
    return parseScalarValue(body, context.source);
  }
  return parseBlockMapping(context, line.indent);
}

/**
 * Parse one canonical workflow. Throws WorkflowYamlError on anything outside the supported subset;
 * the caller turns that into a gate error, so an unparseable template is a failing template.
 */
export function parseWorkflowYaml(text, source = '<workflow>') {
  const body = String(text).replace(/^﻿/, '');
  const rawLines = body.split(/\r?\n/);
  // R5-05: a document's final newline produced a phantom empty LINE, which `readBlockScalar`
  // counted as one more kept trailing newline than the yaml package does for `|+`. It is a line
  // terminator, not a line.
  if (rawLines.length > 1 && rawLines.at(-1) === '') rawLines.pop();
  const lines = rawLines.map((raw, index) => {
    const indent = /^[ \t]*/.exec(raw)[0];
    if (indent.includes('\t')) throw new WorkflowYamlError(`${source}: line ${index + 1} is indented with a tab`);
    return { raw, number: index + 1, indent: indent.length };
  });
  for (const line of lines) {
    const trimmed = line.raw.trimEnd();
    if (trimmed === '---' || trimmed === '...' || trimmed.startsWith('--- ') || trimmed.startsWith('%')) {
      throw new WorkflowYamlError(`${source}: multi-document YAML and directives are not supported in a canonical workflow (line ${line.number})`);
    }
  }
  const context = { lines, i: 0, source };
  const document = parseBlockNode(context, 0);
  context.i = skipBlank(context, context.i);
  if (context.i < lines.length) {
    throw new WorkflowYamlError(`${source}: unexpected content at line ${lines[context.i].number}`);
  }
  return document;
}

// =================================================================================================
// Structural safety analysis.
// =================================================================================================

function asNeeds(value) {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string');
  if (typeof value === 'string') return [value];
  return [];
}

function eventKeys(on) {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return on && typeof on === 'object' ? Object.keys(on) : [];
}

/**
 * R3-02: GitHub Actions accepts an EXPRESSION for `continue-on-error`
 * (`continue-on-error: ${{ matrix.experimental }}` is the documented example) and a job that fails
 * while it is true reports `result == 'success'` to everything that needs it. Only an absent value
 * or a literal false leaves a job blocking; every other value - literal true, a string, an
 * expression - is treated as "error suppression enabled".
 */
export function suppressesFailure(value) {
  if (value === undefined || value === null) return false;
  if (value === false) return false;
  return String(value).trim().toLowerCase() !== 'false';
}

function jobCommands(job) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const commands = [];
  // R3-10: a job that IS a reusable-workflow call has no steps; its `uses:` is its whole body.
  if (typeof job?.uses === 'string') commands.push(job.uses);
  for (const step of steps) {
    if (typeof step?.run === 'string') commands.push(step.run);
    if (typeof step?.uses === 'string') commands.push(step.uses);
  }
  return commands;
}

// An `environment:` that is absent is not production; anything the validator cannot resolve to a
// concrete non-production name (an expression, a mapping without a literal name) fails closed.
function usesProductionEnvironment(job) {
  const environment = job?.environment;
  if (environment === undefined || environment === null) return false;
  let name;
  if (typeof environment === 'string') name = environment;
  else if (typeof environment === 'object' && !Array.isArray(environment)) name = environment.name;
  if (typeof name !== 'string') return true;
  const trimmed = name.trim();
  if (trimmed.includes('${{')) return true;
  return /^prod(?:uction)?$/i.test(trimmed);
}

export function secretNames(serialised) {
  return [...serialised.matchAll(/secrets\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[\s*\\?['"]([^'"\\]+)\\?['"]\s*\])/g)]
    .map((match) => match[1] ?? match[2])
    .filter(Boolean);
}

export function mentionsDeploymentSecrets(serialised) {
  if (/"secrets"\s*:\s*"inherit"/.test(serialised)) return true;
  return secretNames(serialised).some((name) => !NON_PRODUCTION_SECRETS.has(name));
}

/** The production-CLASS secrets a serialised job (plus workflow scope) reads. R5-01 capability rule. */
export function productionSecretNames(serialised) {
  if (/"secrets"\s*:\s*"inherit"/.test(serialised)) return ['inherit'];
  return [...new Set(secretNames(serialised).filter((name) => isProductionSecret(name)))].sort();
}

/**
 * R3-01: the classifier used to serialise the JOB only, so a workflow that declared its deployment
 * secrets at document level put nothing secret-shaped inside any job and the whole gate/condition
 * analysis was skipped. Workflow-level `env:`/`defaults:` reach every job and are folded in here.
 */
function referencesProductionSecrets(job, documentScope = '') {
  return mentionsDeploymentSecrets(`${JSON.stringify(job ?? {})}${documentScope}`);
}

function documentScopeText(document) {
  return JSON.stringify({ env: document?.env ?? null, defaults: document?.defaults ?? null });
}

/**
 * Classify a job by effect, never by name: configured production job, production environment,
 * deployment secrets (its own or the workflow's), or a production promote/deploy/migrate command.
 * A job that only runs a rollback/revert command is a recovery job; anything else that is
 * production-affecting is a production deployment job and must be fully gate-closed.
 */
export function productionRole(jobId, job, configuredIds = [], documentScope = '') {
  if (!job || typeof job !== 'object') return null;
  const commands = jobCommands(job);
  const deploys = commands.some((command) => DEPLOY_ACTION.test(command) && MENTIONS_PRODUCTION.test(command));
  const recovers = commands.some((command) => RECOVERY_ACTION.test(command));
  const affecting = configuredIds.includes(jobId)
    || usesProductionEnvironment(job)
    || referencesProductionSecrets(job, documentScope)
    || deploys;
  if (!affecting) return null;
  return recovers && !deploys ? 'recovery' : 'deployment';
}

function conditionTerms(condition) {
  const inner = String(condition).trim().replace(/^\$\{\{/, '').replace(/\}\}$/, '').trim();
  if (inner.includes('||')) return null;
  return inner.split('&&').map((term) => {
    let text = term.trim();
    while (/^\(.*\)$/s.test(text)) text = text.slice(1, -1).trim();
    return text;
  });
}

function protectedIfErrors(jobId, job, source, role, deploymentIds) {
  const condition = job?.if;
  if (condition === undefined || condition === null) return [];
  if (typeof condition !== 'string') return [`${source}: protected job ${jobId} has a non-string if condition`];
  const terms = conditionTerms(condition);
  if (!terms) return [`${source}: protected job ${jobId} has a disjunctive if condition`];
  if (role !== 'recovery') {
    for (const term of terms) {
      if (term === 'true' || BRANCH_TERM.test(term) || SUCCESS_TERM.test(term)) continue;
      return [`${source}: protected job ${jobId} has a non-blocking or non-branch if condition (${term})`];
    }
    return [];
  }
  // A recovery job is the one shape allowed to observe failure: it must be bound to a SUCCESSFUL
  // production promotion and to an explicit failure result, so it can never carry the release forward.
  const errors = [];
  let boundToPromotionSuccess = false;
  let boundToFailure = false;
  for (const term of terms) {
    if (term === 'true' || ALWAYS_TERM.test(term) || BRANCH_TERM.test(term)) continue;
    const success = SUCCESS_TERM.exec(term);
    if (success) {
      if (deploymentIds.includes(success[1])) boundToPromotionSuccess = true;
      continue;
    }
    if (FAILURE_TERM.test(term)) {
      boundToFailure = true;
      continue;
    }
    errors.push(`${source}: recovery job ${jobId} has an unsupported if term (${term})`);
  }
  if (!boundToPromotionSuccess) errors.push(`${source}: recovery job ${jobId} must require a successful production promotion`);
  if (!boundToFailure) errors.push(`${source}: recovery job ${jobId} must require an explicit failure result`);
  return errors;
}

/** The file name a source label ends in: `ops/release/workflow-templates/ci.yml` -> `ci.yml`. */
export function workflowName(source) {
  return String(source).split('/').pop();
}

// A gate that runs nothing is not a gate. The reviewer's R5-01 reproduction pasted thirteen jobs
// whose only step was `run: "true"`, named after the required gates; the per-document analysis
// accepted them because it only ever asked whether a job with that ID existed.
const NO_OP_RUN = /^\s*(?::|true|exit\s+0|echo(?:\s.*)?)\s*$/;

export function isStubJob(job) {
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  return !steps.some((step) => {
    const run = typeof step?.run === 'string' ? step.run : '';
    if (run.trim() === '') return false;
    return !run.split('\n').every((line) => line.trim() === '' || NO_OP_RUN.test(line));
  });
}

/**
 * R5-01, CAPABILITY RULE. Production capability is a property of the canonical SET, not of whatever
 * a document declares about itself: only `RELEASE_WORKFLOW` may carry it, and inside it only the
 * closed list `PRODUCTION_JOBS` may. Any other workflow file or job that selects a production
 * environment, reads a production-class secret, runs a production deploy command or asks for a
 * write permission fails here - whether or not its digest is in the manifest, and whether or not it
 * brought gate-named jobs of its own.
 */
export function capabilityErrors(document, source, jobs, documentScope, requiredGates = []) {
  const errors = [];
  const name = workflowName(source);
  const isRelease = name === RELEASE_WORKFLOW;
  if (!CANONICAL_WORKFLOW_NAMES.includes(name)) {
    errors.push(`${source}: ${name} is not one of the canonical workflow names (${CANONICAL_WORKFLOW_NAMES.join(', ')}); a managed repository may contain no other workflow`);
  }
  for (const [jobId, job] of Object.entries(jobs)) {
    const reasons = [];
    if (usesProductionEnvironment(job)) reasons.push('environment: production');
    const secrets = productionSecretNames(`${JSON.stringify(job ?? {})}${documentScope}`);
    if (secrets.length) reasons.push(`production secret ${secrets.join('/')}`);
    if (jobCommands(job).some((command) => DEPLOY_ACTION.test(command) && MENTIONS_PRODUCTION.test(command))) {
      reasons.push('a production deploy command');
    }
    if (!reasons.length) continue;
    if (!isRelease) {
      errors.push(`${source}: job ${jobId} carries production capability (${reasons.join('; ')}); only the canonical ${RELEASE_WORKFLOW} may`);
    } else if (!PRODUCTION_JOBS.includes(jobId)) {
      errors.push(`${source}: job ${jobId} carries production capability (${reasons.join('; ')}) and is not one of the canonical production jobs (${PRODUCTION_JOBS.join(', ')})`);
    }
  }
  // Only the release workflow defines the standard's gates. Anywhere else a gate-named job is an
  // imitation of one, which is exactly how R5-01's hotfix satisfied the per-document analysis.
  if (!isRelease) {
    for (const gate of requiredGates) {
      if (jobs[gate]) errors.push(`${source}: declares job ${gate}, which is a required-gate name; only ${RELEASE_WORKFLOW} may define the required gates`);
    }
  }
  return errors;
}

function permissionsErrors(document, source, jobs) {
  const errors = [];
  // R5-01: `deployments: write` is a production capability, so it is bound to the canonical release
  // workflow's closed production-job list rather than to whatever this document classified as a
  // deployment job - a document that declares its own production job cannot grant itself the write.
  const mayWriteDeployments = (jobId) => workflowName(source) === RELEASE_WORKFLOW && PRODUCTION_JOBS.includes(jobId);
  const top = document.permissions;
  if (typeof top === 'string') {
    if (top !== 'read-all') errors.push(`${source}: top-level permissions must be read-all or a least-privilege map`);
  } else if (top && typeof top === 'object' && !Array.isArray(top)) {
    for (const [scope, value] of Object.entries(top)) {
      if (value !== 'read' && value !== 'none') errors.push(`${source}: top-level permission ${scope}: ${value} is not allowed`);
    }
  }
  for (const [jobId, job] of Object.entries(jobs)) {
    const permissions = job?.permissions;
    if (permissions === undefined || permissions === null) continue;
    if (typeof permissions === 'string') {
      if (permissions !== 'read-all') errors.push(`${source}: job ${jobId} permissions must be read-all or a least-privilege map`);
      continue;
    }
    if (typeof permissions !== 'object' || Array.isArray(permissions)) {
      errors.push(`${source}: job ${jobId} has malformed permissions`);
      continue;
    }
    for (const [scope, value] of Object.entries(permissions)) {
      if (value === 'read' || value === 'none') continue;
      if (value === 'write' && scope === 'deployments' && mayWriteDeployments(jobId)) continue;
      errors.push(`${source}: job ${jobId} has unapproved permission ${scope}: ${value}`);
    }
  }
  return errors;
}

/**
 * R7REL-05. The standard's pinned minimum closure for the canonical production jobs, checked on
 * the canonical release workflow. Independent of the policy file and of what the document declares
 * about itself: the constant is in `release-policy.mjs`, and a production job that no longer
 * transitively needs `tree-equivalence` or `smoke` fails here even when every required gate is
 * still in place.
 */
export function productionClosureErrors(document, source, jobs) {
  if (workflowName(source) !== RELEASE_WORKFLOW) return [];
  const errors = [];
  for (const [jobId, required] of Object.entries(PRODUCTION_JOB_DEPENDENCIES)) {
    if (!jobs[jobId]) continue;
    const missing = new Set();
    const closure = dependencyClosure(jobs, [jobId], source, missing);
    for (const dependency of required) {
      if (!closure.has(dependency)) {
        errors.push(`${source}: production job ${jobId} no longer transitively requires ${dependency}; the standard pins that dependency in release-policy.mjs (PRODUCTION_JOB_DEPENDENCIES)`);
      }
    }
    errors.push(...missing);
  }
  return [...new Set(errors)];
}

function dependencyClosure(jobs, roots, source, missing) {
  const seen = new Set();
  const visit = (jobId) => {
    if (seen.has(jobId)) return;
    seen.add(jobId);
    const job = jobs[jobId];
    if (!job) {
      missing.add(`${source}: job dependency ${jobId} is missing`);
      return;
    }
    for (const dependency of asNeeds(job.needs)) visit(dependency);
  };
  roots.forEach(visit);
  return seen;
}

/**
 * Structural safety analysis of ONE canonical workflow template. Since R4-01 this is not only the
 * proof run by release.test.mjs: `validateWorkflowFiles` below runs it over every canonical template
 * of the repository it validates, in the monorepo and in a generated project alike.
 */
export function validateWorkflowDocument(document, source = '<workflow>', raw = '', policy = { requiredGates: [], productionJobId: null, policyPath: '<policy>' }) {
  const errors = [];
  if (!document || typeof document !== 'object') return [`${source}: document is not a mapping`];
  if (!document.permissions || (typeof document.permissions !== 'object' && document.permissions !== 'read-all' && typeof document.permissions !== 'string')) {
    errors.push(`${source}: top-level permissions are required`);
  }
  const jobs = document.jobs && typeof document.jobs === 'object' ? document.jobs : {};
  const documentScope = documentScopeText(document);
  const events = eventKeys(document.on);
  if (events.some((event) => UNSAFE_EVENTS.has(event))) {
    if (events.includes('pull_request_target')) errors.push(`${source}: pull_request_target is forbidden for untrusted code`);
    // R3-01: the document's own env/defaults reach every job of an untrusted-trigger workflow.
    if (/\bsecrets\b/.test(documentScope)) errors.push(`${source}: untrusted-trigger workflow references deployment secrets at workflow level`);
    for (const [jobId, job] of Object.entries(jobs)) {
      const serialised = JSON.stringify(job);
      if (/\bsecrets\b/.test(serialised)) errors.push(`${source}: untrusted-trigger job ${jobId} references deployment secrets`);
      if (job?.environment) errors.push(`${source}: untrusted-trigger job ${jobId} must not select an environment`);
    }
  }

  for (const [jobId, job] of Object.entries(jobs)) {
    // R3-10: a reusable-workflow call runs code this validator never sees.
    if (typeof job?.uses === 'string') errors.push(`${source}: job ${jobId} calls a reusable workflow (${job.uses}); canonical workflows declare their own steps`);
    for (const step of Array.isArray(job?.steps) ? job.steps : []) {
      if (typeof step?.uses === 'string' && /^\.{1,2}\//.test(step.uses.trim())) {
        errors.push(`${source}: job ${jobId} uses a repository-local action (${step.uses}); its body is outside the canonical workflow`);
      }
    }
  }

  const configuredIds = policy.productionJobId && jobs[policy.productionJobId] ? [policy.productionJobId] : [];
  const roles = new Map();
  for (const jobId of Object.keys(jobs)) {
    const role = productionRole(jobId, jobs[jobId], configuredIds, documentScope);
    if (role) roles.set(jobId, role);
  }
  const deploymentIds = [...roles.entries()].filter(([, role]) => role === 'deployment').map(([jobId]) => jobId);

  errors.push(...permissionsErrors(document, source, jobs));
  errors.push(...capabilityErrors(document, source, jobs, documentScope, policy.requiredGates ?? []));
  errors.push(...productionClosureErrors(document, source, jobs));

  if (roles.size) {
    const requiredGates = policy.requiredGates;
    for (const gate of requiredGates) {
      if (!jobs[gate]) errors.push(`${source}: required gate ${gate} from ${policy.policyPath} is missing`);
      else if (isStubJob(jobs[gate])) errors.push(`${source}: required gate ${gate} runs no real command; a stub job is not a gate`);
    }
    const missing = new Set();
    const protectedJobs = new Set();
    for (const jobId of roles.keys()) {
      const closure = dependencyClosure(jobs, [jobId], source, missing);
      for (const gate of requiredGates) {
        if (!closure.has(gate)) errors.push(`${source}: ${jobId} is not transitively blocked by required gate ${gate}`);
      }
      for (const member of closure) protectedJobs.add(member);
    }
    errors.push(...missing);
    for (const jobId of protectedJobs) {
      const job = jobs[jobId];
      if (!job) continue;
      if (suppressesFailure(job['continue-on-error'])) errors.push(`${source}: protected job ${jobId} must not use continue-on-error`);
      for (const step of Array.isArray(job.steps) ? job.steps : []) {
        if (suppressesFailure(step?.['continue-on-error'])) errors.push(`${source}: protected job ${jobId} has a step with continue-on-error`);
      }
      errors.push(...protectedIfErrors(jobId, job, source, roles.get(jobId) ?? null, deploymentIds));
    }
  }

  if (/release\.ya?ml$/i.test(source) && !/vercel[^\n]{0,100}auto[- ]deploy[^\n]{0,100}disabled|auto[- ]deploy[^\n]{0,100}disabled[^\n]{0,100}vercel/i.test(raw)) {
    errors.push(`${source}: must document that Vercel auto-deploy-to-production is disabled`);
  }
  return errors;
}

// =================================================================================================
// The canonical set: pinned by a digest manifest, rendered, analysed, then compared byte for byte.
// =================================================================================================

function yamlNames(directory) {
  if (!existsSync(directory)) return null;
  return readdirSync(directory).sort();
}

export function loadWorkflowParameters(rootDir) {
  const path = join(resolve(rootDir), PARAMETER_FILE);
  if (!existsSync(path)) return { parameters: {}, errors: [], path: null };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { parameters: {}, errors: [`${PARAMETER_FILE}: is not valid JSON (${error instanceof Error ? error.message : 'parse error'})`], path };
  }
  const values = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.parameters : null;
  if (values === undefined || values === null) return { parameters: {}, errors: [], path };
  if (typeof values !== 'object' || Array.isArray(values)) {
    return { parameters: {}, errors: [`${PARAMETER_FILE}: "parameters" must be a mapping of name to value`], path };
  }
  const errors = [];
  const parameters = {};
  for (const [name, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      errors.push(`${PARAMETER_FILE}: parameter name ${name} must be upper snake case`);
      continue;
    }
    if (typeof value !== 'string' || !PARAMETER_VALUE.test(value)) {
      errors.push(`${PARAMETER_FILE}: parameter ${name} must be a plain token; an expression, quote, newline or shell metacharacter is refused`);
      continue;
    }
    parameters[name] = value;
  }
  return { parameters, errors, path };
}

/**
 * Render one canonical template with the project's parameters. Substitution is total: every
 * `__NAME__` placeholder must have a parameter, and every parameter must be used by the canonical
 * set, so a template and its parameter file can never disagree silently.
 *
 * R5-04: "every parameter is used" is a property of the SET, not of one template. Checked per
 * template it made `workflow-params.json` unusable in any repository with more than one canonical
 * workflow - a generated project has two, so every parameter failed against the template that did
 * not mention it and the feature was dead as shipped. `loadCanonicalTemplates` therefore passes
 * `reportUnused: false` and checks the union itself; a direct caller keeps the per-template report.
 */
export function renderCanonicalWorkflow(template, parameters = {}, source = '<template>', { reportUnused = true } = {}) {
  const errors = [];
  const used = new Set();
  const content = String(template).replace(PLACEHOLDER, (placeholder) => {
    const name = placeholder.slice(2, -2);
    if (!Object.prototype.hasOwnProperty.call(parameters, name)) {
      errors.push(`${source}: no value for workflow parameter ${name}`);
      return placeholder;
    }
    used.add(name);
    return parameters[name];
  });
  if (reportUnused) {
    for (const name of Object.keys(parameters)) {
      if (!used.has(name)) errors.push(`${source}: workflow parameter ${name} is not used by this template`);
    }
  }
  return { content, errors, used };
}

/**
 * R4-01: the canonical template SET is pinned by a checked-in `sha256sum`-style manifest. An added
 * template, a removed template and a single edited byte each fail until the manifest is updated in
 * the same change, so "canonical" is a reviewed decision rather than whatever the directory holds.
 */
export function parseTemplateManifest(text, source = TEMPLATE_MANIFEST) {
  const entries = new Map();
  const errors = [];
  String(text).split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const match = /^([0-9a-f]{64}) {2}(\S.*)$/.exec(line.replace(/\s+$/, ''));
    if (!match) {
      errors.push(`${source}: line ${index + 1} is not a "<sha256>  <template>" entry`);
      return;
    }
    const name = match[2];
    if (entries.has(name)) {
      errors.push(`${source}: ${name} is pinned twice`);
      return;
    }
    entries.set(name, match[1]);
  });
  if (entries.size === 0 && errors.length === 0) errors.push(`${source}: pins no canonical workflow template`);
  return { entries, errors };
}

export function verifyTemplateManifest(rootDir, rawTemplates) {
  const path = join(resolve(rootDir), TEMPLATE_MANIFEST);
  if (!existsSync(path)) {
    return [`${TEMPLATE_MANIFEST}: the reviewed digest manifest of the canonical templates is missing; this repository cannot be validated`];
  }
  const { entries, errors } = parseTemplateManifest(readFileSync(path, 'utf8'));
  for (const [name, content] of rawTemplates) {
    const digest = createHash('sha256').update(content).digest('hex');
    const pinned = entries.get(name);
    if (!pinned) {
      errors.push(`${TEMPLATE_DIRECTORY}/${name}: is not pinned by ${TEMPLATE_MANIFEST}; a new canonical workflow needs a reviewed manifest entry`);
      continue;
    }
    if (pinned !== digest) {
      errors.push(`${TEMPLATE_DIRECTORY}/${name}: no longer matches ${TEMPLATE_MANIFEST} (pinned ${pinned.slice(0, 12)}, found ${digest.slice(0, 12)}); a template change needs a reviewed manifest update`);
    }
  }
  for (const name of entries.keys()) {
    if (!rawTemplates.has(name)) {
      errors.push(`${TEMPLATE_DIRECTORY}/${name}: is pinned by ${TEMPLATE_MANIFEST} but is missing from this repository`);
    }
  }
  return errors;
}

/**
 * R5-01, PROVENANCE RULE. The digest of a repository's release CONTROLS.
 *
 * R9REL-04: it used to be TWO files - the template manifest and the release policy - while the
 * success line said `Release controls: <digest> matching the standard's template version 1.0.0`, a
 * sentence an operator reads as "the controls in this project are the standard's". It now covers
 * every file the standard DELIVERS under `ops/release/`: the gate programs, the self-test, the
 * declarations, the canonical templates, the plan and the policy.
 *
 * Two files are deliberately outside it, and the success line says so rather than implying
 * otherwise:
 *   - `ops/release/validate-workflows.mjs` carries `DELIVERED_RELEASE_CONTROLS`, the pin itself. A
 *     digest that included the file holding it has no fixed point - it is not a policy choice but
 *     arithmetic. That file is byte-compared against the standard's own copy by
 *     `ops/release/release.test.mjs` at delivery time and is a code-owner path in both plans, which
 *     is exactly the residual D-014 assigns to review.
 *   - `ops/release/secret-scan.allowlist` is written per project by the generator (it binds the
 *     scanner to the identity values that generator produced), so it is the project's, not the
 *     standard's.
 */
export const CONTROLS_DIGEST_EXCLUDED = [
  'ops/release/validate-workflows.mjs',
  'ops/release/secret-scan.allowlist',
];

export const RELEASE_CONTROL_DIRECTORY = 'ops/release';

export function releaseControlsDigest(entries) {
  const lines = [...entries]
    .map(([name, content]) => `${createHash('sha256').update(content).digest('hex')}  ${name}`)
    .sort();
  return createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
}

/** Every delivered file under `ops/release/`, depth-first and sorted, as repository-relative paths. */
function releaseControlFiles(root) {
  const base = join(root, RELEASE_CONTROL_DIRECTORY);
  if (!existsSync(base) || !statSync(base).isDirectory()) return null;
  const walk = (directory, prefix) => readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const full = join(directory, name);
      const relativePath = `${prefix}/${name}`;
      if (statSync(full).isDirectory()) return walk(full, relativePath);
      return [[relativePath, full]];
    });
  return walk(base, RELEASE_CONTROL_DIRECTORY);
}

export function controlEntries(rootDir, policyPath) {
  const root = resolve(rootDir);
  const found = releaseControlFiles(root);
  if (found === null) return null;
  const excluded = new Set(CONTROLS_DIGEST_EXCLUDED);
  const entries = new Map();
  for (const [name, absolute] of found) {
    if (excluded.has(name)) continue;
    entries.set(name, readFileSync(absolute));
  }
  // The template manifest and the resolved policy are REQUIRED, wherever the policy lives: a
  // generated project keeps it beside the controls, and the path is part of the digest, so moving
  // the policy to a location that takes precedence is a change too.
  for (const path of [join(root, TEMPLATE_MANIFEST), policyPath]) {
    if (!path || !existsSync(path)) return null;
    const name = relative(root, path).split('\\').join('/');
    if (!entries.has(name)) entries.set(name, readFileSync(path));
  }
  return [...entries];
}

/**
 * Verify the delivered controls of a GENERATED project against the standard that generated it.
 *
 * R7REL-01. Which repository this is comes from `repositoryKind`: a launch manifest or any
 * delivered control file makes it a generated project, and only the standard's own check exiting 0
 * makes it the standard. In a generated project the manifest is REQUIRED: missing, unreadable,
 * unparseable or without a `templateVersion`, each is an error naming the file. A tree that is
 * neither is refused rather than silently exempted, and the reason says what was missing.
 */
export function provenanceErrors(rootDir, policyPath, { standardCheck = runStandardCheck } = {}) {
  const root = resolve(rootDir);
  const repository = repositoryKind(root, { standardCheck });
  const launchPath = join(root, LAUNCH_MANIFEST);
  const empty = { digest: null, templateVersion: null, kind: repository.kind, why: repository.why, controlCount: 0 };
  if (repository.kind === 'unknown') {
    return { ...empty, errors: [`${LAUNCH_MANIFEST}: the provenance of this repository's release controls cannot be established - ${repository.why}`] };
  }
  if (repository.kind === 'standard') {
    // R10REL-01: the standard's own gates are pinned by content too.
    const own = controlEntries(root, policyPath);
    if (!own) return { ...empty, errors: [`${RELEASE_CONTROL_DIRECTORY}/: a release control of the standard is missing, so its gates cannot be verified (R10REL-01)`] };
    const digest = releaseControlsDigest(own);
    const errors = digest === STANDARD_RELEASE_CONTROLS_SHA256 ? [] : [`${RELEASE_CONTROL_DIRECTORY}/ (${own.length} files): the standard's own release controls no longer match STANDARD_RELEASE_CONTROLS_SHA256 (pinned ${STANDARD_RELEASE_CONTROLS_SHA256.slice(0, 12)}, found ${digest.slice(0, 12)}); a reviewed change updates the pin in both validate-workflows.mjs copies (R10REL-01)`];
    return { ...empty, digest, controlCount: own.length, errors };
  }
  if (!repository.manifest) {
    return { ...empty, errors: [`${LAUNCH_MANIFEST}: is missing, but this repository was delivered as a generated project (${repository.delivered.join(', ')}); the launch manifest is what binds its release controls to a reviewed standard and removing it does not make this repository the standard`] };
  }
  let launch;
  try {
    launch = JSON.parse(readFileSync(launchPath, 'utf8'));
  } catch (error) {
    return { ...empty, errors: [`${LAUNCH_MANIFEST}: cannot be read as JSON, so the delivered release controls cannot be verified (${error instanceof Error ? error.message : 'parse error'})`] };
  }
  const errors = [];
  const entries = controlEntries(root, policyPath);
  if (!entries) {
    return { ...empty, errors: [`${TEMPLATE_MANIFEST}/${PROJECT_POLICY}: a delivered release control is missing, so this project's provenance cannot be verified`] };
  }
  const digest = releaseControlsDigest(entries);
  const templateVersion = launch && typeof launch.templateVersion === 'string' ? launch.templateVersion : null;
  if (!templateVersion) {
    errors.push(`${LAUNCH_MANIFEST}: records no templateVersion, so the delivered release controls cannot be bound to a reviewed standard`);
  } else if (!DELIVERED_RELEASE_CONTROLS.has(templateVersion)) {
    errors.push(`${LAUNCH_MANIFEST}: template version ${templateVersion} is not pinned by this gate (pinned: ${[...DELIVERED_RELEASE_CONTROLS.keys()].join(', ')}); the delivered gate and the launch manifest disagree about which standard this project came from`);
  } else if (DELIVERED_RELEASE_CONTROLS.get(templateVersion) !== digest) {
    errors.push(`${RELEASE_CONTROL_DIRECTORY}/ (${entries.length} delivered control files): the delivered release controls no longer match the standard's ${templateVersion} controls (pinned ${DELIVERED_RELEASE_CONTROLS.get(templateVersion).slice(0, 12)}, found ${digest.slice(0, 12)}); editing the digest manifest, a template, the gate declaration and the policy together does not make the change canonical`);
  }
  // The generator records this digest in the launch manifest as well, so the delivered gate has a
  // root of trust in the project's own reviewed manifest and not only in the constant inside its
  // own source; the delivered branch-protection plan lists the field as requiring code-owner
  // review. R6REL-01: in a generated project the field is REQUIRED, so deleting it is as visible
  // as deleting the file - both are a gate failure, neither is an exemption.
  const declared = launch?.releaseControlsSha256 ?? launch?.release_controls_sha256;
  if (declared === undefined || declared === null) {
    if (repository.kind === 'generated') {
      errors.push(`${LAUNCH_MANIFEST}: records no releaseControlsSha256, so the delivered release controls are bound to nothing this project's own reviewed manifest states`);
    }
  } else if (declared !== digest) {
    errors.push(`${LAUNCH_MANIFEST}: releaseControlsSha256 ${String(declared).slice(0, 12)} does not match the delivered release controls (${digest.slice(0, 12)})`);
  }
  return { errors, digest, templateVersion, kind: repository.kind, why: repository.why, controlCount: entries.length };
}

/**
 * R6REL-01, GATE-SET RULE. `release.required_gates` is data in the repository being validated: the
 * sixth review cut a generated project's delivered policy to one gate, and every production job's
 * required dependency closure shrank with it. The canonical set is pinned in `release-policy.mjs`;
 * a policy file may require MORE than the standard, never less. Independent of the provenance rule
 * by construction - it reads no manifest, no digest and no file the repository can delete.
 */
export function requiredGateSetErrors(policy) {
  const policyPath = policy?.policyPath ?? PROJECT_POLICY;
  const required = new Set(Array.isArray(policy?.requiredGates) ? policy.requiredGates : []);
  const missing = CANONICAL_REQUIRED_GATES.filter((gate) => !required.has(gate));
  if (missing.length === 0) return [];
  return [`${policyPath}: release.required_gates omits ${missing.join(', ')}; the standard's canonical gate set (${CANONICAL_REQUIRED_GATES.length}: ${CANONICAL_REQUIRED_GATES.join(', ')}) is pinned in the gate's own source and a repository's policy file may add to it but never shrink it`];
}

export function loadCanonicalTemplates(rootDir) {
  const absoluteRoot = resolve(rootDir);
  const directory = join(absoluteRoot, TEMPLATE_DIRECTORY);
  const names = yamlNames(directory);
  if (names === null) {
    return { templates: new Map(), raw: new Map(), errors: [`${TEMPLATE_DIRECTORY}: the canonical workflow templates are missing; this repository cannot be validated`] };
  }
  const errors = [];
  const templates = new Map();
  const raw = new Map();
  const { parameters, errors: parameterErrors } = loadWorkflowParameters(absoluteRoot);
  errors.push(...parameterErrors);
  const usedParameters = new Set();
  for (const name of names) {
    const path = join(directory, name);
    if (!statSync(path).isFile() || !/\.ya?ml$/i.test(name)) {
      errors.push(`${TEMPLATE_DIRECTORY}/${name}: only workflow templates (*.yml) may live here`);
      continue;
    }
    // R5-01, CAPABILITY RULE (a): the permitted names are a constant of the standard, checked
    // BEFORE any digest. A template nobody may ship is refused even when its digest is pinned, so
    // "add hotfix.yml plus one manifest line" is no longer a path at all.
    if (!CANONICAL_WORKFLOW_NAMES.includes(name)) {
      errors.push(`${TEMPLATE_DIRECTORY}/${name}: ${name} is not one of the canonical workflow names (${CANONICAL_WORKFLOW_NAMES.join(', ')}); pinning it in ${TEMPLATE_MANIFEST} does not make it canonical`);
      continue;
    }
    const bytes = readFileSync(path);
    raw.set(name, bytes);
    const rendered = renderCanonicalWorkflow(bytes.toString('utf8'), parameters, `${TEMPLATE_DIRECTORY}/${name}`, { reportUnused: false });
    errors.push(...rendered.errors);
    for (const parameter of rendered.used) usedParameters.add(parameter);
    if (LOCAL_ACTION.test(rendered.content)) {
      errors.push(`${TEMPLATE_DIRECTORY}/${name}: a canonical workflow may not call a repository-local action`);
    }
    if (rendered.errors.length === 0) templates.set(name, rendered.content);
  }
  for (const name of Object.keys(parameters)) {
    if (!usedParameters.has(name)) errors.push(`${PARAMETER_FILE}: workflow parameter ${name} is not used by any canonical workflow template`);
  }
  if (!templates.size && !errors.length) errors.push(`${TEMPLATE_DIRECTORY}: holds no canonical workflow`);
  return { templates, raw, errors };
}

function firstDifference(expected, actual) {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  for (let index = 0; index < Math.max(expectedLines.length, actualLines.length); index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return `line ${index + 1}: expected ${JSON.stringify(expectedLines[index] ?? '<end of file>')}, found ${JSON.stringify(actualLines[index] ?? '<end of file>')}`;
    }
  }
  return 'trailing bytes differ';
}

/**
 * R4-01: the structural analysis of every canonical template, run by the gate itself. The workflows
 * under `.github/workflows/` are required below to be byte-identical to these renderings, so a
 * workflow that reaches a runner has been through this analysis.
 */
function analyseCanonicalTemplates(templates, policy) {
  const errors = [];
  for (const [name, content] of templates) {
    const source = `${TEMPLATE_DIRECTORY}/${name}`;
    let document;
    try {
      document = parseWorkflowYaml(content, source);
    } catch (error) {
      errors.push(`${source}: cannot be analysed (${error instanceof Error ? error.message : 'parse error'})`);
      continue;
    }
    errors.push(...validateWorkflowDocument(document, source, content, policy));
  }
  return errors;
}

/**
 * THE GATE. The canonical template set is pinned by a digest manifest, every template passes the
 * structural analysis, every file under `.github/workflows/` is byte-identical to a canonical
 * rendering, every canonical workflow is present, and nothing else may be there.
 */
export function validateWorkflowFiles(rootDir = process.cwd(), { policy, standardCheck = runStandardCheck } = {}) {
  const absoluteRoot = resolve(rootDir);
  const { templates, raw, errors } = loadCanonicalTemplates(absoluteRoot);
  errors.push(...verifyTemplateManifest(absoluteRoot, raw));

  let releasePolicy = policy ?? null;
  if (!releasePolicy) {
    try {
      releasePolicy = loadReleasePolicy(join(absoluteRoot, 'standard/policy/global-policy.yaml'), absoluteRoot);
    } catch (error) {
      errors.push(`${TEMPLATE_DIRECTORY}: the release policy could not be read, so the canonical workflows cannot be analysed (${error instanceof Error ? error.message : 'unreadable'})`);
    }
  }
  if (releasePolicy) {
    // R6REL-01: before the policy is allowed to decide anything, it has to carry the standard's own
    // gate set. A downgraded policy fails here even when nothing else in the repository is checkable.
    errors.push(...requiredGateSetErrors(releasePolicy));
    errors.push(...analyseCanonicalTemplates(templates, releasePolicy));
  }
  // R8REL-07. EVERY file this gate judges is read BEFORE the standard check is allowed to run.
  // `provenanceErrors` is the only step that executes a program out of the tree being validated, and
  // it used to run before the rendered workflows were read: a `standard/check-standard.mjs` spawned
  // there could still rewrite `.github/workflows/*.yml` to match the templates that had already been
  // loaded, and the comparison below would then read the rewritten bytes. The bytes are captured
  // first and compared from memory, so that window is gone. (R8REL-04 removes the ability to plant
  // such a program at all; this is the second, independent half.)
  const workflowDirectory = join(absoluteRoot, WORKFLOW_DIRECTORY);
  const present = yamlNames(workflowDirectory);
  const files = [];
  const captured = new Map();
  const notAFile = [];
  if (present !== null) {
    for (const name of present) {
      const path = join(workflowDirectory, name);
      files.push(path);
      if (!statSync(path).isFile()) {
        notAFile.push(name);
        continue;
      }
      captured.set(name, readFileSync(path, 'utf8'));
    }
  }

  const provenance = provenanceErrors(absoluteRoot, releasePolicy?.policyPath ?? null, { standardCheck });
  errors.push(...provenance.errors);

  const report = {
    policyPath: releasePolicy ? relative(absoluteRoot, releasePolicy.policyPath).split('\\').join('/') : null,
    requiredGates: releasePolicy?.requiredGates ?? [],
    controlsDigest: provenance.digest,
    controlCount: provenance.controlCount,
    templateVersion: provenance.templateVersion,
    repositoryKind: provenance.kind,
    repositoryKindWhy: provenance.why,
  };
  if (present === null) {
    errors.push(`${WORKFLOW_DIRECTORY}: directory is missing; the canonical workflows (${[...templates.keys()].join(', ')}) must be committed`);
    return { files, errors, templates: [...templates.keys()], ...report };
  }
  for (const name of present) {
    if (notAFile.includes(name)) {
      errors.push(`${WORKFLOW_DIRECTORY}/${name}: only workflow files may live here`);
      continue;
    }
    // CAPABILITY RULE (a), on the rendered side: a name outside the standard's constant is refused
    // here too, so a repository cannot legitimise a workflow by shipping a template for it.
    if (!CANONICAL_WORKFLOW_NAMES.includes(name)) {
      errors.push(`${WORKFLOW_DIRECTORY}/${name}: ${name} is not one of the canonical workflow names (${CANONICAL_WORKFLOW_NAMES.join(', ')}); a managed repository may contain no other workflow`);
      continue;
    }
    if (!templates.has(name)) {
      errors.push(`${WORKFLOW_DIRECTORY}/${name}: is not a canonical workflow; only ${[...templates.keys()].join(', ')} may exist here`);
      continue;
    }
    const actual = captured.get(name);
    const expected = templates.get(name);
    if (actual !== expected) {
      errors.push(`${WORKFLOW_DIRECTORY}/${name}: differs from the canonical ${TEMPLATE_DIRECTORY}/${name} (${firstDifference(expected, actual)})`);
    }
  }
  for (const name of templates.keys()) {
    if (!present.includes(name)) errors.push(`${WORKFLOW_DIRECTORY}/${name}: the canonical workflow is missing`);
  }
  return { files, errors, templates: [...templates.keys()], ...report };
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
  const positional = args.find((arg) => !arg.startsWith('--'));
  const result = validateWorkflowFiles(positional ? resolve(positional) : process.cwd());
  // R7REL-01: the chosen mode and its evidence are printed whatever the outcome, so a log never
  // has to be read backwards to find out which rules this run applied.
  process.stdout.write(`Repository mode: ${result.repositoryKind} - ${result.repositoryKindWhy}\n`);
  if (result.errors.length) {
    for (const error of result.errors) process.stderr.write(`${error}\n`);
    process.exitCode = 1;
  } else {
    // R5-02: a successful run never said WHICH policy it had used, so a downgraded policy file was
    // invisible in the job log. The resolved path, the gate list it produced and the provenance of
    // the delivered controls are printed on success.
    process.stdout.write(`Validated ${result.files.length} workflow files against the canonical set (${result.templates.join(', ')})\n`);
    process.stdout.write(`Release policy: ${result.policyPath} - required gates (${result.requiredGates.length}): ${result.requiredGates.join(', ')}\n`);
    // R6REL-04: the old success line reported "carries no .project-launch-starter.json, so it is
    // validated as the standard itself" - a statement about a TAMPERED generated project that was
    // false, printed by the control that was supposed to catch the tampering. R7REL-01 removes the
    // last inference: a successful run is a generated project whose provenance was verified, or a
    // tree in which the standard's own check RAN and exited 0. Nothing is concluded from a file
    // that is merely absent or merely present.
    // R9REL-04: the sentence now names exactly what the digest covers. It used to read "matching
    // the standard's template version 1.0.0" about TWO files - the template manifest and the
    // policy - while an operator read it as "the control programs in this project are the
    // standard's". It covers every delivered file under ops/release/ except the two named here, and
    // says which those are instead of leaving the reader to assume there are none.
    process.stdout.write(result.repositoryKind === 'standard'
      ? `Release controls: ${String(result.controlsDigest).slice(0, 16)} - ${result.controlCount} files under ${RELEASE_CONTROL_DIRECTORY}/ plus the release policy match STANDARD_RELEASE_CONTROLS_SHA256; ${STANDARD_CHECK} here is byte-identical to the standard's pinned check and exited 0, so this tree is the standard itself\n`
      : result.controlsDigest
      ? `Release controls: ${result.controlsDigest.slice(0, 16)} - ${result.controlCount} delivered files under ${RELEASE_CONTROL_DIRECTORY}/ plus the release policy match the standard's template version ${result.templateVersion}; ${CONTROLS_DIGEST_EXCLUDED.join(' and ')} are outside this digest and are bound by code-owner review alone\n`
      : `Release controls: none to verify - ${STANDARD_CHECK} here is byte-identical to the standard's pinned check and exited 0, so this tree is the standard itself, not a project generated from it\n`);
  }
}
